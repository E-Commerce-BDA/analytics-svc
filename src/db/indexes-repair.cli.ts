import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { createConnection, type Connection } from 'mongoose';
import {
  isInvalidUniqueIdIndex,
  repairIndexes,
  type RepairableIndexDb,
} from './indexes.js';

/**
 * One-shot migration for the invalid `unique: true` `_id` index declaration.
 *
 * The source fix stops new deployments from sending that spec, but a database
 * that already holds such an index would keep failing `createIndexes` at boot.
 * This CLI drops it and re-applies the current declarations. It is idempotent:
 * a clean database reports zero drops and only no-op index creations.
 *
 * Usage (after `pnpm build`):
 *   node --env-file=.env dist/db/indexes-repair.cli.js
 *   node --env-file=.env dist/db/indexes-repair.cli.js --dry-run
 */

interface RepairOptions {
  readonly uri: string;
  readonly dryRun: boolean;
}

function parseArgs(argv: string[]): RepairOptions {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required (run with --env-file=.env)');
  }
  return { uri, dryRun: argv.includes('--dry-run') };
}

export async function repairIndexesInDb(
  connection: Connection,
  options: Pick<RepairOptions, 'dryRun'>,
  logger: Pick<Logger, 'log'>,
): Promise<{ dropped: string[] }> {
  const db = connection.db;
  if (!db) throw new Error('Mongo connection is not ready');

  if (options.dryRun) {
    const target = db as unknown as RepairableIndexDb;
    const wouldDrop: string[] = [];
    for (const name of [
      'page_views',
      'cart_events',
      'order_events',
      'user_events',
      'abandonment_windows',
      'processed_events',
    ]) {
      const coll = target.collection(name);
      for (const existing of await coll.indexes()) {
        if (isInvalidUniqueIdIndex(existing)) {
          wouldDrop.push(`${name}.${existing.name}`);
        }
      }
    }
    logger.log(
      wouldDrop.length
        ? `index repair (dry run) would drop ${wouldDrop.join(', ')}`
        : 'index repair (dry run): nothing to drop',
    );
    return { dropped: wouldDrop };
  }

  const dropped = await repairIndexes(db as unknown as RepairableIndexDb);
  logger.log(
    dropped.length
      ? `index repair dropped ${dropped.join(', ')} and re-applied current indexes`
      : 'index repair: no invalid indexes found; current indexes applied',
  );
  return { dropped };
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const logger = new Logger('IndexesRepair');
  const connection: Connection = createConnection();
  try {
    await connection.openUri(options.uri, { serverSelectionTimeoutMS: 2000 });
    const summary = await repairIndexesInDb(connection, options, logger);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await connection.close();
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    new Logger('IndexesRepair').error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
