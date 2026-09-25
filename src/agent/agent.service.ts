import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  Channel,
  ConversationStatus,
  MessageRole,
  Prisma,
} from '../generated/prisma/client.js';
import {
  MODEL_CLIENT,
  type ModelClient,
  type ModelTurn,
  type ProviderMessage,
} from '../model/model-client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ToolExecutor } from '../tools/tool-executor.service.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

// Upper bound on model calls for one customer message. A normal answer
// takes 1 to 3 (ask for a tool, get the result, reply). The limit stops a
// model that keeps calling tools from looping forever and burning quota.
export const MAX_MODEL_CALLS = 6;

// Sent when the agent cannot finish, in both of the store's languages
// because we don't know which one the customer used.
export const FALLBACK_REPLY =
  "Sorry, I couldn't finish handling your message. Someone from our team will contact you. / " +
  "Désolé, je n'ai pas pu traiter votre message. Quelqu'un de notre équipe va vous contacter.";

// Sent, without calling the model, once a conversation is in human hands.
export const HANDED_OFF_REPLY =
  'Your conversation has been passed to our team, who will reply to you here. / ' +
  'Votre conversation a été transmise à notre équipe, qui vous répondra ici.';

export interface AgentReply {
  conversationId: string;
  reply: string;
  status: ConversationStatus;
}

// The agent loop. For each customer message:
//
//   save it → send the whole conversation to the model →
//     model asks for tools?  run them, save results, ask the model again
//     model answers?         save and return the answer
//
// Every step is written to the database before the next one starts, so the
// stored conversation is always what the model actually saw.
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ToolExecutor,
    @Inject(MODEL_CLIENT) private readonly model: ModelClient,
  ) {}

  async startConversation(channel: Channel): Promise<string> {
    const conversation = await this.prisma.conversation.create({
      data: { channel },
    });
    return conversation.id;
  }

  async reply(conversationId: string, text: string): Promise<AgentReply> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    await this.save(conversationId, 'USER', this.model.userMessage(text));

    // Once escalated, the conversation is the team's. The message is kept
    // for them, but the agent no longer answers.
    if (conversation.status !== 'OPEN') {
      return {
        conversationId,
        reply: HANDED_OFF_REPLY,
        status: conversation.status,
      };
    }

    for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
      let turn: ModelTurn;
      try {
        turn = await this.model.generate({
          system: SYSTEM_PROMPT,
          history: await this.history(conversationId),
          tools: this.tools.definitions,
        });
      } catch (error) {
        this.logger.error(`Model call failed in ${conversationId}`, error);
        return this.giveUp(conversationId, 'The AI model could not be reached');
      }

      await this.save(conversationId, 'ASSISTANT', turn.message, turn.usage);

      if (turn.toolCalls.length > 0) {
        const results = await this.tools.runAll(turn.toolCalls, {
          conversationId,
        });
        // Tool results go back as a USER message: in the model's view,
        // everything that is not the model speaking comes from the user side.
        await this.save(
          conversationId,
          'USER',
          this.model.toolResultsMessage(results),
        );
        continue;
      }

      if (!turn.finished || !turn.text) {
        return this.giveUp(
          conversationId,
          `The AI model stopped without a usable answer (${turn.stopReason})`,
        );
      }

      // escalateToHuman may have run during this message.
      const { status } = await this.prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { status: true },
      });
      return { conversationId, reply: turn.text, status };
    }

    return this.giveUp(
      conversationId,
      `The AI model made more than ${MAX_MODEL_CALLS} calls for one message`,
    );
  }

  // The conversation as the model needs it: every stored message, in order.
  private async history(conversationId: string): Promise<ProviderMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { seq: 'asc' },
      select: { content: true },
    });
    return messages.map((message) => message.content);
  }

  private async save(
    conversationId: string,
    role: MessageRole,
    content: ProviderMessage,
    usage?: ModelTurn['usage'],
  ) {
    await this.prisma.message.create({
      data: {
        conversationId,
        role,
        content: content as Prisma.InputJsonValue,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      },
    });
  }

  // When the agent fails, a person takes over instead of the customer
  // getting an error. The reason is stored for them.
  private async giveUp(
    conversationId: string,
    reason: string,
  ): Promise<AgentReply> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'ESCALATED',
        escalationReason: `Agent failure: ${reason}`,
        closedAt: new Date(),
      },
    });
    return { conversationId, reply: FALLBACK_REPLY, status: 'ESCALATED' };
  }
}
