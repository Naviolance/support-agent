import { Module } from '@nestjs/common';
import { StoreDbService } from './store-db.service.js';
import { StoreService } from './store.service.js';

// Read-only access to the truck parts store's data.
@Module({
  providers: [StoreDbService, StoreService],
  exports: [StoreService],
})
export class StoreModule {}
