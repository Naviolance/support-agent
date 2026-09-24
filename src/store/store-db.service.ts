import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResultRow } from 'pg';

// Connection pool to the STORE database, as agent_readonly. The role itself
// enforces read-only access; this class only owns the connections.
@Injectable()
export class StoreDbService implements OnModuleDestroy {
  private readonly logger = new Logger(StoreDbService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('STORE_READONLY_URL'),
      max: 5, // the agent must never compete with the store for connections
    });
    // Without this listener, an idle connection dropped by the server emits
    // an unhandled 'error' event, which crashes the whole Node process.
    this.pool.on('error', (err) =>
      this.logger.error(`Idle store DB connection failed: ${err.message}`),
    );
  }

  // Parameters are always passed separately ($1, $2...), never concatenated
  // into the SQL string, so user input cannot change the query (SQL injection).
  async query<T extends QueryResultRow>(sql: string, params: unknown[]) {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
