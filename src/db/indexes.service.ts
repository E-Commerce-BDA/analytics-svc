import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ensureIndexes, type IndexDb } from './indexes.js';

/**
 * Applies the index declarations at boot. Mongo creates existing indexes as a
 * no-op, so a restart is safe and a new deployment gets its TTL without a
 * manual migration step.
 */
@Injectable()
export class IndexesService implements OnModuleInit {
  private readonly logger = new Logger(IndexesService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit(): Promise<void> {
    const db = this.connection.db;
    if (!db) {
      throw new Error('Mongo connection is not ready; cannot create indexes');
    }
    await ensureIndexes(db as unknown as IndexDb);
    this.logger.log('Analytics collections and TTL indexes are ready');
  }
}
