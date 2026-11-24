import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  CartAbandonedPayload,
  PageViewedPayload,
} from '@ecom/contracts';
import type {
  EventTopic,
  MongoSessionLike,
  OutboxStorePort,
  OutboxWriteInput,
} from '@ecom/messaging';
import { OUTBOX_STORE } from '@ecom/messaging/nest/outbox';

export interface PageViewWrite {
  topic: 'page.viewed';
  aggregateId: string;
  payload: PageViewedPayload;
  occurredAt?: Date;
}

export interface CartAbandonedWrite {
  aggregateId: string;
  payload: CartAbandonedPayload;
  occurredAt?: Date;
}

/**
 * Writes `page.viewed` into `analytics_outbox` inside the caller's transaction.
 * The messaging store validates the payload against the contracts schema before
 * the insert, so a drifted payload fails the request instead of leaving an event
 * no consumer can parse.
 */
@Injectable()
export class AnalyticsOutbox {
  constructor(
    @Inject(OUTBOX_STORE) private readonly store: OutboxStorePort<MongoSessionLike>,
  ) {}

  record(session: MongoSessionLike, write: PageViewWrite): Promise<string> {
    return this.write(session, {
      topic: 'page.viewed',
      eventId: randomUUID(),
      aggregateType: 'page_view',
      aggregateId: write.aggregateId,
      occurredAt: write.occurredAt ?? new Date(),
      payload: write.payload,
    });
  }

  /** anl-004: one reminder per idle window, keyed by the chosen cart identity. */
  recordCartAbandoned(
    session: MongoSessionLike,
    write: CartAbandonedWrite,
  ): Promise<string> {
    return this.write(session, {
      topic: 'cart.abandoned',
      eventId: randomUUID(),
      aggregateType: 'cart_abandonment',
      aggregateId: write.aggregateId,
      occurredAt: write.occurredAt ?? new Date(),
      payload: write.payload,
    });
  }

  private write<T extends EventTopic>(
    session: MongoSessionLike,
    input: OutboxWriteInput<T>,
  ): Promise<string> {
    return this.store.write(session, input);
  }
}
