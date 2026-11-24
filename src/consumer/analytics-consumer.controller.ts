import { Controller } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  Payload,
  type KafkaContext,
} from '@nestjs/microservices';
import { KafkaEventHandler } from '@ecom/messaging/nest/consumer';
import { AnalyticsEventHandler } from './handlers.js';

const CART_UPDATED = 'cart.updated';
const ORDER_CREATED = 'order.created';
const PAGE_VIEWED = 'page.viewed';
const USER_REGISTERED = 'user.registered';

/**
 * Four routes on the one shared Kafka strategy and one group. Parsing, retries,
 * dead lettering, counters and the offset commit all belong to
 * KafkaEventHandler; each method only names its topic and hands the handler
 * the parsed envelope.
 */
@Controller()
export class AnalyticsConsumerController {
  constructor(
    private readonly events: KafkaEventHandler,
    private readonly handler: AnalyticsEventHandler,
  ) {}

  @EventPattern(CART_UPDATED)
  async onCartUpdated(@Payload() raw: string, @Ctx() ctx: unknown): Promise<void> {
    await this.events.run(ctx as KafkaContext, CART_UPDATED, raw, (envelope) =>
      this.handler.handle(envelope),
    );
  }

  @EventPattern(ORDER_CREATED)
  async onOrderCreated(@Payload() raw: string, @Ctx() ctx: unknown): Promise<void> {
    await this.events.run(ctx as KafkaContext, ORDER_CREATED, raw, (envelope) =>
      this.handler.handle(envelope),
    );
  }

  @EventPattern(PAGE_VIEWED)
  async onPageViewed(@Payload() raw: string, @Ctx() ctx: unknown): Promise<void> {
    await this.events.run(ctx as KafkaContext, PAGE_VIEWED, raw, (envelope) =>
      this.handler.handle(envelope),
    );
  }

  @EventPattern(USER_REGISTERED)
  async onUserRegistered(@Payload() raw: string, @Ctx() ctx: unknown): Promise<void> {
    await this.events.run(ctx as KafkaContext, USER_REGISTERED, raw, (envelope) =>
      this.handler.handle(envelope),
    );
  }
}
