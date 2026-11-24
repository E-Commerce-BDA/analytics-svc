import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { CartAbandonedPayload } from '@ecom/contracts';
import type { MongoSessionLike } from '@ecom/messaging';
import type { ClientSession, Connection } from 'mongoose';
import { MongoTransactions } from '../db/mongo-tx.js';
import { AnalyticsOutbox } from '../outbox/analytics-outbox.js';

export interface IdleCart {
  cartId: string;
  userId: string | null;
  sessionId: string | null;
  itemsCount: number;
  subtotal: number;
  lastActivityAt: Date;
}

interface CollectionLike {
  aggregate(stages: Record<string, unknown>[]): { toArray(): Promise<unknown[]> };
  insertOne(
    doc: Record<string, unknown>,
    options: { session: ClientSession },
  ): Promise<unknown>;
}

interface AbandonmentDb {
  collection(name: string): CollectionLike;
}

interface LatestCartRow {
  _id: string;
  last: {
    cartId: string;
    userId: string | null;
    sessionId: string | null;
    status: string;
    itemsCount: number;
    totals: { subtotal: number };
    createdAt: string;
  };
}

/**
 * Finds carts that have gone quiet and publishes one cart.abandoned per idle
 * window. The marker, not the event id, owns idempotency: envelope ids must be
 * UUIDs, so the outbox row gets a fresh one and the marker carries the window
 * key `<cartId>|<lastActivityAt>`.
 */
@Injectable()
export class AbandonmentWriter {
  constructor(
    private readonly transactions: MongoTransactions,
    private readonly outbox: AnalyticsOutbox,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async scan(cutoff: Date, batch: number): Promise<IdleCart[]> {
    const rows = (await this.db()
      .collection('cart_events')
      .aggregate([
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$cartId', last: { $first: '$$ROOT' } } },
        { $match: { 'last.status': 'active', 'last.createdAt': { $lte: cutoff.toISOString() } } },
        { $limit: batch },
      ])
      .toArray()) as unknown as LatestCartRow[];

    return rows.map(({ last }) => ({
      cartId: last.cartId,
      userId: last.userId,
      sessionId: last.sessionId,
      itemsCount: last.itemsCount,
      subtotal: last.totals.subtotal,
      lastActivityAt: new Date(last.createdAt),
    }));
  }

  async publish(cart: IdleCart, now: Date = new Date()): Promise<boolean> {
    const windowKey = `${cart.cartId}|${cart.lastActivityAt.toISOString()}`;

    return this.transactions.run(async (session) => {
      try {
        await this.db().collection('abandonment_windows').insertOne(
          {
            _id: windowKey,
            cartId: cart.cartId,
            lastActivityAt: cart.lastActivityAt,
            createdAt: now,
          },
          { session },
        );
      } catch (error) {
        // A duplicate marker means this window already produced an event.
        if ((error as { code?: number }).code === 11000) return false;
        throw error;
      }

      const payload: CartAbandonedPayload = {
        cartId: cart.cartId,
        userId: cart.userId,
        sessionId: cart.sessionId,
        itemsCount: cart.itemsCount,
        subtotal: cart.subtotal,
        lastActivityAt: cart.lastActivityAt.toISOString(),
        abandonedAt: now.toISOString(),
      };

      await this.outbox.recordCartAbandoned(session as MongoSessionLike, {
        // Guests have no userId; their session id (or cart id) still keys the
        // event so notify can address one reminder per cart.
        aggregateId: cart.userId ?? cart.sessionId ?? cart.cartId,
        payload,
        occurredAt: now,
      });
      return true;
    });
  }

  private db(): AbandonmentDb {
    if (!this.connection.db) {
      throw new Error('Mongo connection is not ready: carts cannot be scanned');
    }
    return this.connection.db as unknown as AbandonmentDb;
  }
}
