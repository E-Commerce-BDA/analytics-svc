import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mongoose';
import { backfillPendingOutbox } from './outbox-backfill.cli.js';

const ID = '0190a8b0-0000-7000-8000-000000000a01';
const NOW = '2026-11-26T10:00:00.000Z';

const canonical = {
  id: ID,
  type: 'page.viewed',
  version: 1,
  timestamp: NOW,
  producer: 'analytics-svc',
  idempotencyKey: ID,
  payload: { sessionId: 's-1', page: '/x', eventKind: 'pageview', timestamp: NOW },
};

const legacyDoc = () => ({
  _id: ID,
  event_id: ID,
  event_type: 'page.viewed',
  status: 'pending',
  created_at: new Date(NOW),
  envelope: { id: ID, type: 'page.viewed', timestamp: NOW, producer: 'analytics-svc', payload: canonical.payload },
});

function setup(docs: Record<string, unknown>[], dryRun = false) {
  const find = vi.fn((_filter: Record<string, unknown>) => ({
    project: (_fields: Record<string, 1>) => ({
      batchSize: (_size: number) =>
        (async function* () {
          for (const doc of docs) yield doc;
        })(),
    }),
  }));
  const updateOne = vi.fn(
    async (_filter: Record<string, unknown>, _update: Record<string, unknown>) => ({
      matchedCount: 1,
      modifiedCount: 1,
    }),
  );
  const connection = {
    db: { collection: () => ({ find, updateOne }) },
  } as unknown as Connection;
  const logger = { log: vi.fn(), warn: vi.fn() };
  return { connection, logger, find, updateOne, options: { collection: 'analytics_outbox', batch: 10, dryRun } };
}

describe('outbox backfill CLI', () => {
  it('scans only pending rows and writes the canonical envelope', async () => {
    const s = setup([legacyDoc(), { ...legacyDoc(), envelope: { ...canonical } }]);
    const summary = await backfillPendingOutbox(s.connection, s.options, s.logger);
    expect(s.find).toHaveBeenCalledWith({ status: 'pending' });
    expect(summary).toEqual({ unchanged: 1, updated: 1, skipped: 0, skippedReasons: [] });
    expect(s.updateOne).toHaveBeenCalledWith(
      { _id: ID, status: 'pending' },
      { $set: { envelope: canonical } },
    );
  });

  it('reports a dry run without writing', async () => {
    const s = setup([legacyDoc()], true);
    const summary = await backfillPendingOutbox(s.connection, s.options, s.logger);
    expect(summary.updated).toBe(1);
    expect(s.updateOne).not.toHaveBeenCalled();
  });

  it('leaves a row that cannot be made canonical alone and reports why', async () => {
    const doc = legacyDoc();
    doc.event_type = 'unknown.topic';
    const s = setup([doc]);
    const summary = await backfillPendingOutbox(s.connection, s.options, s.logger);
    expect(summary.skipped).toBe(1);
    expect(summary.skippedReasons[0]).toContain('unknown.topic');
    expect(s.updateOne).not.toHaveBeenCalled();
  });
});
