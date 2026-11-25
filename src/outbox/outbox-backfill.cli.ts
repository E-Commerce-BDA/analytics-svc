import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { createConnection, type Connection } from 'mongoose';
import { canonicalizeOutboxRow, type OutboxBackfillRow } from './outbox-backfill.js';

/**
 * One-shot migration for 1.x outbox rows left pending at the 2.0.0 cutover.
 *
 * Run it with analytics-svc stopped: the relay publishes the stored envelope
 * verbatim, so a row must not be claimed between the read and the rewrite. The
 * rewrite itself is idempotent (a canonical envelope is reported `unchanged`)
 * and only touches `status: "pending"` documents, so a published row's history
 * stays intact.
 *
 * Usage (after `pnpm build`):
 *   node --env-file=.env dist/outbox/outbox-backfill.cli.js
 *   node --env-file=.env dist/outbox/outbox-backfill.cli.js --dry-run
 *   node --env-file=.env dist/outbox/outbox-backfill.cli.js --collection analytics_outbox --batch 200
 */

interface CliOptions {
  readonly uri: string;
  readonly collection: string;
  readonly batch: number;
  readonly dryRun: boolean;
}

interface BackfillSummary {
  unchanged: number;
  updated: number;
  skipped: number;
  skippedReasons: string[];
}

/**
 * Structural view of the driver collection: the outbox `_id` is the event id
 * (a string), which the driver's generic `ObjectId` filter cannot express.
 */
interface BackfillCollection {
  find(filter: Record<string, unknown>): {
    project(fields: Record<string, 1>): { batchSize(size: number): AsyncIterable<unknown> };
  };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;
}

function parseArgs(argv: string[]): CliOptions {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      flags.set(arg.slice(2), argv[i + 1] ?? '');
      i += 1;
    }
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required (run with --env-file=.env)');
  }
  const batch = Number(flags.get('batch') ?? 500);
  return {
    uri,
    collection: flags.get('collection') || 'analytics_outbox',
    batch: Number.isInteger(batch) && batch > 0 ? batch : 500,
    dryRun: flags.has('dry-run'),
  };
}

function toRow(raw: unknown): OutboxBackfillRow {
  const doc = raw as Record<string, unknown>;
  return {
    id: String(doc._id),
    eventId: typeof doc.event_id === 'string' ? doc.event_id : String(doc._id),
    eventType: typeof doc.event_type === 'string' ? doc.event_type : '',
    envelope: doc.envelope as Record<string, unknown>,
    createdAt: doc.created_at instanceof Date ? doc.created_at : undefined,
  };
}

export async function backfillPendingOutbox(
  connection: Connection,
  options: Pick<CliOptions, 'collection' | 'batch' | 'dryRun'>,
  logger: Pick<Logger, 'log' | 'warn'>,
): Promise<BackfillSummary> {
  const summary: BackfillSummary = { unchanged: 0, updated: 0, skipped: 0, skippedReasons: [] };
  const db = connection.db;
  if (!db) throw new Error('Mongo connection is not ready');
  const collection = db.collection(options.collection) as unknown as BackfillCollection;

  // All pending rows, not just ones with a missing field: a dual-written row
  // whose envelope `type` disagrees with `event_type` also needs a rewrite.
  const cursor = collection
    .find({ status: 'pending' })
    .project({ _id: 1, event_id: 1, event_type: 1, envelope: 1, created_at: 1 })
    .batchSize(options.batch);

  for await (const raw of cursor) {
    const row = toRow(raw);
    const result = canonicalizeOutboxRow(row);
    if (result.kind === 'unchanged') {
      summary.unchanged += 1;
      continue;
    }
    if (result.kind === 'skipped') {
      summary.skipped += 1;
      summary.skippedReasons.push(`${row.id}: ${result.reason}`);
      continue;
    }
    if (options.dryRun) {
      summary.updated += 1;
      continue;
    }
    // The status predicate keeps a row the relay claimed meanwhile untouched.
    const write = await collection.updateOne(
      { _id: row.id, status: 'pending' },
      { $set: { envelope: result.envelope } },
    );
    if (write.matchedCount === 0) {
      logger.warn(`${row.id} was no longer pending; left as-is`);
      continue;
    }
    summary.updated += write.modifiedCount;
  }

  logger.log(
    `outbox backfill: ${summary.updated} updated, ${summary.unchanged} already canonical, ` +
      `${summary.skipped} skipped${options.dryRun ? ' (dry run, nothing written)' : ''}`,
  );
  for (const reason of summary.skippedReasons) logger.warn(`skipped ${reason}`);
  return summary;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const logger = new Logger('OutboxBackfill');
  const connection: Connection = createConnection();
  try {
    await connection.openUri(options.uri, { serverSelectionTimeoutMS: 2000 });
    const summary = await backfillPendingOutbox(connection, options, logger);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    // A skipped row still cannot be relayed after cutover; make CI notice.
    if (summary.skipped > 0) process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    new Logger('OutboxBackfill').error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
