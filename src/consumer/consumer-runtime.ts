import {
  Injectable,
  Logger,
  type INestApplication,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaDlqPublisher, type RelayLogger } from '@ecom/messaging';
import { createKafkaConsumerStrategy } from '@ecom/messaging/nest/consumer';

/**
 * The group is exactly the service name. Nest appends `-server` unless told
 * otherwise, which would create a second group with its own offsets - so
 * `postfixId: ''` and this constant have to agree.
 */
export const CONSUMER_GROUP_ID = 'analytics-svc';

export function kafkaBrokers(config: ConfigService): string[] {
  return config
    .get<string>('KAFKA_BROKERS', 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
}

export class NestRelayLogger implements RelayLogger {
  constructor(private readonly logger: Logger) {}

  debug(message: string): void {
    this.logger.debug(message);
  }

  warn(message: string): void {
    this.logger.warn(message);
  }

  error(message: string, error?: unknown): void {
    this.logger.error(message, formatError(error));
  }
}

function formatError(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === 'string') return error;
  if (
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint'
  ) {
    return `${error}`;
  }
  return error === undefined || error === null ? undefined : JSON.stringify(error);
}

const consumerLogger = new Logger('EventConsumer');
const RECONNECT_DELAY_MS = 5000;

/**
 * Starts the four-topic consumer separately from HTTP: an e2e suite must never
 * join a group, so it sets KAFKA_CONSUMER_ENABLED=false and the switch is
 * checked here rather than by whether the module happens to exist.
 *
 * A broker that is down does not stop beacon ingestion - analytics still writes
 * page views over HTTP - so a failed start is retried every five seconds and
 * main.ts does not await it.
 */
export async function startEventConsumer(
  app: INestApplication,
  config: ConfigService,
): Promise<boolean> {
  const enabled = config.get<string | boolean>('KAFKA_CONSUMER_ENABLED', true);
  if (enabled === false || enabled === 'false') {
    consumerLogger.warn(
      'KAFKA_CONSUMER_ENABLED=false; the analytics event consumer is not started',
    );
    return false;
  }

  app.connectMicroservice({
    strategy: createKafkaConsumerStrategy({
      brokers: kafkaBrokers(config),
      clientId: CONSUMER_GROUP_ID,
      groupId: CONSUMER_GROUP_ID,
    }),
  });

  for (let attempt = 1; ; attempt += 1) {
    try {
      await app.startAllMicroservices();
      consumerLogger.log(
        `Analytics consumer started: group ${CONSUMER_GROUP_ID} on the Nest Kafka transport`,
      );
      return true;
    } catch (error) {
      consumerLogger.error(
        `Analytics consumer failed to start (attempt ${attempt}): ${describe(error)}. Retrying in ${RECONNECT_DELAY_MS / 1000}s`,
      );
      await pause(RECONNECT_DELAY_MS);
    }
  }
}

/** Closes the DLQ producer on shutdown; Nest stops the consumer itself. */
@Injectable()
export class ConsumerRuntime implements OnModuleDestroy {
  constructor(private readonly dlq: KafkaDlqPublisher) {}

  async onModuleDestroy(): Promise<void> {
    await this.dlq.close();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}
