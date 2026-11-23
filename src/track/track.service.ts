import { Injectable } from '@nestjs/common';
import type { PageViewedPayload } from '@ecom/contracts';
import { MongoTransactions } from '../db/mongo-tx.js';
import { AnalyticsOutbox } from '../outbox/analytics-outbox.js';
import type { TrackEventDto } from './dto/track-event.dto.js';

/**
 * Turns a validated beacon into one `page.viewed` outbox row. Nothing is
 * published synchronously: the messaging relay drains the outbox after commit,
 * so a slow broker can never slow the shopper's navigation.
 */
@Injectable()
export class TrackService {
  constructor(
    private readonly outbox: AnalyticsOutbox,
    private readonly transactions: MongoTransactions,
  ) {}

  async record(dto: TrackEventDto): Promise<string> {
    const payload: PageViewedPayload = {
      ...dto,
      // Server time wins: a client clock must not be able to skew funnels.
      timestamp: new Date().toISOString(),
    };

    return this.transactions.run((session) =>
      this.outbox.record(session, {
        topic: 'page.viewed',
        aggregateId: payload.sessionId,
        payload,
        occurredAt: new Date(payload.timestamp),
      }),
    );
  }
}
