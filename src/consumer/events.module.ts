import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsumerMetrics, KafkaDlqPublisher } from '@ecom/messaging';
import {
  KafkaEventHandler,
  type KafkaEventHandlerOptions,
} from '@ecom/messaging/nest/consumer';
import { AnalyticsConsumerController } from './analytics-consumer.controller.js';
import {
  CONSUMER_GROUP_ID,
  ConsumerRuntime,
  NestRelayLogger,
  kafkaBrokers,
} from './consumer-runtime.js';
import { AnalyticsFactStore } from './fact-store.js';
import { AnalyticsEventHandler } from './handlers.js';

/**
 * The default ladder sleeps 31s, longer than the 45s broker session once the
 * handler's work is counted. At 20s it truncates to 1/2/4/8s - five attempts
 * over 15s of sleeps - leaving room for the fact write and the commit.
 */
export const RETRY_BUDGET_MS = 20_000;

/** Shared by the Nest provider and the ladder regression test. */
export function createAnalyticsEventHandler(
  dlq: KafkaDlqPublisher,
  metrics: ConsumerMetrics,
  overrides: Partial<KafkaEventHandlerOptions> = {},
): KafkaEventHandler {
  return new KafkaEventHandler({
    dlq,
    metrics,
    logger: new NestRelayLogger(new Logger('KafkaConsumer')),
    retryBudgetMs: RETRY_BUDGET_MS,
    ...overrides,
  });
}

/**
 * The analytics consume side: four topics, one group and one commit protocol.
 * All providers are lazy - building the module in a test opens no broker.
 */
@Module({
  controllers: [AnalyticsConsumerController],
  providers: [
    AnalyticsFactStore,
    AnalyticsEventHandler,
    ConsumerMetrics,
    {
      provide: KafkaDlqPublisher,
      useFactory: (config: ConfigService) =>
        new KafkaDlqPublisher({
          brokers: kafkaBrokers(config),
          clientId: `${CONSUMER_GROUP_ID}-dlq`,
        }),
      inject: [ConfigService],
    },
    {
      provide: KafkaEventHandler,
      useFactory: (dlq: KafkaDlqPublisher, metrics: ConsumerMetrics) =>
        createAnalyticsEventHandler(dlq, metrics),
      inject: [KafkaDlqPublisher, ConsumerMetrics],
    },
    ConsumerRuntime,
  ],
  exports: [KafkaEventHandler, AnalyticsEventHandler],
})
export class EventsModule {}
