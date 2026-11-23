import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

export interface LivenessResponse {
  status: 'ok';
}

export interface ReadinessResponse {
  status: 'ready';
  checks: { mongo: 'up' };
}

const PING_TIMEOUT_MS = 2000;

/**
 * Liveness never touches a dependency: a process that can answer is alive.
 * Readiness requires Mongo, because an analytics service with no database
 * cannot collect anything and should be taken out of rotation.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  checkLiveness(): LivenessResponse {
    return { status: 'ok' };
  }

  async checkReadiness(): Promise<ReadinessResponse> {
    try {
      await this.pingMongo();
      return { status: 'ready', checks: { mongo: 'up' } };
    } catch (error) {
      this.logger.error(
        'MongoDB readiness probe failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { mongo: 'down' },
      });
    }
  }

  private async pingMongo(): Promise<void> {
    const db = this.connection.db;
    if (!db) throw new Error('MongoDB connection is not established');

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        db.admin().ping(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('MongoDB ping timed out')),
            PING_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
