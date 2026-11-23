import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';

/**
 * Run `fn` inside one MongoDB transaction.
 *
 * Legal against the local single-node replica set because the MONGODB_URI uses
 * directConnection=true. The outbox store's `write` needs a session; anl-002
 * writes one row per beacon, and anl-003 will write a fact + processed_events
 * in the same transaction.
 *
 * withTransaction retries the callback on transient errors, so `fn` must be
 * safe to re-run — it is, because an aborted transaction leaves nothing behind.
 */
export async function withMongoTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    const result: { value: T } = { value: undefined as T };
    await session.withTransaction(async () => {
      result.value = await fn(session);
    });
    return result.value;
  } finally {
    await session.endSession();
  }
}

@Injectable()
export class MongoTransactions {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  run<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    return withMongoTransaction(this.connection, fn);
  }
}
