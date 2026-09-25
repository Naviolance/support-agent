import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { STORE_POOL } from './store.constants.js';
import { StoreService } from './store.service.js';

// Read-only access to the truck parts store database, through the
// agent_readonly user (see db/store-readonly-user.sql). Plain `pg` with
// hand-written SQL: the store owns its schema, the agent runs a few fixed
// read queries, so a second ORM mirroring the store's tables is not worth it.
@Global()
@Module({
  providers: [
    {
      provide: STORE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          connectionString: config.getOrThrow<string>('STORE_READONLY_URL'),
          // The store serves real customers. The agent keeps its footprint
          // small and shows up by name in pg_stat_activity.
          max: 3,
          application_name: 'support-agent',
          connectionTimeoutMillis: 5_000,
        }),
    },
    StoreService,
  ],
  exports: [StoreService],
})
export class StoreModule implements OnModuleDestroy {
  constructor(@Inject(STORE_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
