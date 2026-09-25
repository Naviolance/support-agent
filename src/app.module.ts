import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StoreModule } from './store/store.module.js';
import { AgentModule } from './agent/agent.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    StoreModule,
    AgentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
