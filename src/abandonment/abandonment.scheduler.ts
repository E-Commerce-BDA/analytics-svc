import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AbandonmentWriter } from './abandonment-writer.js';

const DEFAULT_AFTER_MS = 30 * 60 * 1000;
const DEFAULT_BATCH = 100;

/**
 * Publishes a reminder for carts that have gone quiet.
 *
 * The timer is deliberately separate from the sweep: tests call sweep()
 * directly so a background cron cannot make their assertions racy, and e2e
 * runs skip the timer entirely.
 */
@Injectable()
export class CartAbandonmentScheduler {
  private readonly logger = new Logger(CartAbandonmentScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly writer: AbandonmentWriter,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async handleSweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    const enabled = this.config.get<string | boolean>('ABANDONMENT_SWEEP_ENABLED', true);
    if (enabled === false || enabled === 'false') return;

    try {
      const sent = await this.sweep();
      if (sent > 0) this.logger.log(`Published ${sent} cart.abandoned event(s)`);
    } catch (error) {
      this.logger.error(
        'Cart abandonment sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async sweep(now: Date = new Date()): Promise<number> {
    const afterMs = this.config.get<number>('CART_ABANDONED_AFTER_MS', DEFAULT_AFTER_MS);
    const batch = this.config.get<number>('ABANDONMENT_SWEEP_BATCH_SIZE', DEFAULT_BATCH);
    const cutoff = new Date(now.getTime() - afterMs);
    const idle = await this.writer.scan(cutoff, batch);

    let sent = 0;
    for (const cart of idle) {
      if (await this.writer.publish(cart, now)) sent += 1;
    }
    return sent;
  }
}
