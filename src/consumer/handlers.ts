import { Injectable, Logger } from '@nestjs/common';
import {
  parseEventPayload,
  readEventEnvelope,
  type CartUpdatedPayload,
  type OrderCreatedPayload,
  type PageViewedPayload,
  type UserRegisteredPayload,
} from '@ecom/contracts';
import type { KafkaHandlerOutcome } from '@ecom/messaging/nest/consumer';
import { AnalyticsFactStore } from './fact-store.js';

const TOPICS = [
  'cart.updated',
  'order.created',
  'page.viewed',
  'user.registered',
] as const;

type Topic = (typeof TOPICS)[number];

/**
 * Turns the four domain events into append-only facts.
 *
 * Each fact and its processed_events claim are written in one Mongo transaction
 * by the fact store, so a redelivery is a no-op and a crash cannot leave an
 * event marked done without its fact. The event carries no email, and the user
 * fact stores only the id and timestamp - funnels need a cohort, not a name.
 */
@Injectable()
export class AnalyticsEventHandler {
  private readonly logger = new Logger(AnalyticsEventHandler.name);

  constructor(private readonly facts: AnalyticsFactStore) {}

  async handle(raw: unknown): Promise<KafkaHandlerOutcome> {
    let envelope: ReturnType<typeof readEventEnvelope>;
    try {
      envelope = readEventEnvelope(raw);
    } catch (error) {
      return { kind: 'invalid', stage: 'envelope', error: describe(error) };
    }

    if (!TOPICS.includes(envelope.type as Topic)) {
      return { kind: 'ignored', reason: 'not-subscribed', type: envelope.type };
    }

    const topic = envelope.type as Topic;

    switch (topic) {
      case 'page.viewed':
        return this.record(topic, envelope.id, 'page_views', () => {
          const p = parseEventPayload(topic, envelope.payload) as PageViewedPayload;
          return {
            sessionId: p.sessionId,
            userId: p.userId,
            page: p.page,
            referrer: p.referrer,
            device: p.device,
            eventKind: p.eventKind,
            durationMs: p.durationMs,
            exited: p.exited,
            createdAt: p.timestamp,
          };
        });
      case 'cart.updated':
        return this.record(topic, envelope.id, 'cart_events', () => {
          const p = parseEventPayload(topic, envelope.payload) as CartUpdatedPayload;
          return {
            cartId: p.cartId,
            userId: p.userId,
            sessionId: p.sessionId,
            status: p.status,
            totals: p.totals,
            itemsCount: p.totals.itemCount,
            createdAt: p.updatedAt,
          };
        });
      case 'order.created':
        return this.record(topic, envelope.id, 'order_events', () => {
          const p = parseEventPayload(topic, envelope.payload) as OrderCreatedPayload;
          return {
            orderId: p.orderId,
            orderNumber: p.orderNumber,
            userId: p.userId,
            grandTotal: p.grandTotal,
            itemsCount: p.itemsCount,
            createdAt: p.createdAt,
          };
        });
      case 'user.registered':
        return this.record(topic, envelope.id, 'user_events', () => {
          const p = parseEventPayload(topic, envelope.payload) as UserRegisteredPayload;
          return { userId: p.userId, createdAt: p.registeredAt };
        });
    }
  }

  private async record(
    topic: Topic,
    eventId: string,
    collection: string,
    build: () => Record<string, unknown>,
  ): Promise<KafkaHandlerOutcome> {
    let fact: Record<string, unknown>;
    try {
      fact = build();
    } catch (error) {
      this.logger.warn(`Invalid ${topic} payload: ${describe(error)}`);
      return { kind: 'invalid', stage: 'payload', error: describe(error) };
    }

    const claimed = await this.facts.record(eventId, topic, collection, fact);
    return claimed
      ? { kind: 'applied' }
      : { kind: 'duplicate', eventId };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
