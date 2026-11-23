import { Global, Module } from '@nestjs/common';
// Narrow entry, not the `/nest` barrel: analytics has no Kafka consumer yet
// (anl-003 will add one), and the barrel would pull in the consumer surface.
import { createMongoOutboxModule } from '@ecom/messaging/nest/outbox';
import { mongoOutboxDb } from '../db/mongo-connection.js';
import { AnalyticsOutbox } from './analytics-outbox.js';

@Global()
@Module({
  imports: [
    createMongoOutboxModule({
      collection: 'analytics_outbox',
      producer: 'analytics-svc',
      clientId: 'analytics-svc',
      db: () => mongoOutboxDb(),
    }),
  ],
  providers: [AnalyticsOutbox],
  exports: [AnalyticsOutbox],
})
export class AnalyticsOutboxModule {}
