import { Module } from '@nestjs/common';
import { ModelModule } from '../model/model.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { AgentService } from './agent.service.js';

@Module({
  imports: [ModelModule, ToolsModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
