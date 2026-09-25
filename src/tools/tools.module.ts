import { Module } from '@nestjs/common';
import { EscalateToHumanTool } from './escalate-to-human.tool.js';
import { GetOrderTool } from './get-order.tool.js';
import { SearchProductsTool } from './search-products.tool.js';
import { ToolExecutor } from './tool-executor.service.js';

// The agent's tools. Only ToolExecutor is exported: the agent loop asks it
// for the definitions and hands it the model's tool calls, and never touches
// a tool directly.
@Module({
  providers: [
    GetOrderTool,
    SearchProductsTool,
    EscalateToHumanTool,
    ToolExecutor,
  ],
  exports: [ToolExecutor],
})
export class ToolsModule {}
