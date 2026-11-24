import { Global, Module } from '@nestjs/common';
// Narrow entry, not the `/nest` barrel: analytics consumes but never enqueues
// SQS tasks, and the barrel would pull in the task surface and its optional peer.
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
