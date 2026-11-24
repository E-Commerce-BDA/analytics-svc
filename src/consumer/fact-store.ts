import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';
import { MongoTransactions } from '../db/mongo-tx.js';

interface CollectionLike {
  insertOne(
    doc: Record<string, unknown>,
    options: { session: ClientSession },
  ): Promise<unknown>;
}

export interface FactDb {
  collection(name: string): CollectionLike;
}

/**
 * The Mongo half of the consumer protocol.
 *
 * Messaging's ProcessedEventsStore is SQL-only, so analytics claims an event by
 * inserting `_id: eventId` into `processed_events`. The unique index makes the
 * database decide who wins a redelivery; a duplicate key is the only acceptable
 * failure. The claim and the fact insert share one Mongo transaction, so a
 * crash between them leaves neither behind.
 */
@Injectable()
export class AnalyticsFactStore {
  constructor(
    private readonly transactions: MongoTransactions,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async record(
    eventId: string,
    topic: string,
    collection: string,
    fact: Record<string, unknown>,
  ): Promise<boolean> {
    return this.transactions.run(async (session) => {
      if (!(await this.claim(session, eventId, topic))) return false;
      await this.db().collection(collection).insertOne(fact, { session });
      return true;
    });
  }

  private db(): FactDb {
    if (!this.connection.db) {
      throw new Error('Mongo connection is not ready: facts cannot be written');
    }
    return this.connection.db as unknown as FactDb;
  }

  private async claim(
    session: ClientSession,
    eventId: string,
    topic: string,
  ): Promise<boolean> {
    try {
      await this.db().collection('processed_events').insertOne(
        { _id: eventId, eventId, topic, processedAt: new Date() },
        { session },
      );
      return true;
    } catch (error) {
      // 11000 is the duplicate-key code; any other error must surface so the
      // record is retried instead of being silently treated as a duplicate.
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }
}
