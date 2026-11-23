import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { MongoOutboxDb } from '@ecom/messaging';
import type { Connection } from 'mongoose';

/**
 * The `db` thunk `createMongoOutboxModule` asks for.
 *
 * The outbox module is a plain DynamicModule, so its store factory has no
 * injector of its own. The connection is captured by this provider while the
 * module graph is being built — before any onModuleInit runs — so the thunk is
 * always safe to call once the app is live.
 */
let current: Connection | null = null;

@Injectable()
export class MongoConnectionBinder {
  constructor(@InjectConnection() connection: Connection) {
    current = connection;
  }
}

export function mongoConnection(): Connection {
  if (!current) {
    throw new Error(
      'Mongo connection requested before DbModule resolved it; only use the outbox after app init',
    );
  }
  return current;
}

/** Structural view of the driver `Db` for the messaging outbox store. */
export function mongoOutboxDb(): MongoOutboxDb {
  const db = mongoConnection().db;
  if (!db) {
    throw new Error('Mongo connection is not ready: the outbox cannot be used');
  }
  return db as unknown as MongoOutboxDb;
}
