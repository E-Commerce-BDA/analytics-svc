import { Module } from '@nestjs/common';
import { AbandonmentWriter } from './abandonment-writer.js';
import { CartAbandonmentScheduler } from './abandonment.scheduler.js';

/**
 * anl-004: turns quiet carts into cart.abandoned outbox rows. It shares the
 * service's Mongo connection and outbox; the marker collection owns the
 * one-event-per-idle-window guarantee.
 */
@Module({
  providers: [AbandonmentWriter, CartAbandonmentScheduler],
  exports: [AbandonmentWriter],
})
export class AbandonmentModule {}
