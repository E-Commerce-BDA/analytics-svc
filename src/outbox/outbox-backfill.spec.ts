import { describe, expect, it } from 'vitest';
import {
  canonicalizeOutboxRow,
  type OutboxBackfillRow,
} from './outbox-backfill.js';

const ID = '0190a8b0-0000-7000-8000-000000000a01';
const NOW = '2026-11-26T10:00:00.000Z';
const payload = { sessionId: 's-1', page: '/x', eventKind: 'pageview', timestamp: NOW };

const canonical = {
  id: ID,
  type: 'page.viewed',
  version: 1,
  timestamp: NOW,
  producer: 'analytics-svc',
  idempotencyKey: ID,
  payload,
};

const row = (overrides: Partial<OutboxBackfillRow> = {}): OutboxBackfillRow => ({
  id: ID,
  eventId: ID,
  eventType: 'page.viewed',
  envelope: { ...canonical },
  createdAt: new Date(NOW),
  ...overrides,
});

describe('outbox envelope backfill', () => {
  it('leaves an already canonical envelope untouched', () => {
    expect(canonicalizeOutboxRow(row())).toEqual({ kind: 'unchanged', id: ID });
  });

  it('rewrites a dual-written 1.x envelope and drops both aliases', () => {
    const result = canonicalizeOutboxRow(
      row({
        envelope: {
          id: ID,
          type: 'page.viewed',
          topic: 'page.viewed',
          eventType: 'page.viewed',
          timestamp: NOW,
          producer: 'analytics-svc',
          payload,
        },
      }),
    );
    expect(result).toEqual({ kind: 'updated', id: ID, envelope: canonical });
  });

  it('adds version and idempotencyKey to an alias-free 1.x envelope', () => {
    const result = canonicalizeOutboxRow(
      row({
        envelope: {
          id: ID,
          type: 'page.viewed',
          timestamp: NOW,
          producer: 'analytics-svc',
          payload,
        },
      }),
    );
    expect(result).toEqual({ kind: 'updated', id: ID, envelope: canonical });
  });

  it('takes the event name from the row column, not from an envelope alias', () => {
    const result = canonicalizeOutboxRow(row({ eventType: 'cart.abandoned' }));
    expect(result).toEqual({
      kind: 'updated',
      id: ID,
      envelope: { ...canonical, type: 'cart.abandoned' },
    });
  });

  it('recovers a missing timestamp from the row creation time', () => {
    const withoutTimestamp: Record<string, unknown> = { ...canonical };
    delete withoutTimestamp.timestamp;
    const result = canonicalizeOutboxRow(row({ envelope: withoutTimestamp }));
    expect(result).toEqual({ kind: 'updated', id: ID, envelope: canonical });
  });

  it('is idempotent: a rewritten envelope passes through unchanged', () => {
    const first = canonicalizeOutboxRow(
      row({ envelope: { id: ID, timestamp: NOW, producer: 'analytics-svc', payload } }),
    );
    expect(first.kind).toBe('updated');
    if (first.kind !== 'updated') return;
    expect(canonicalizeOutboxRow(row({ envelope: first.envelope }))).toEqual({
      kind: 'unchanged',
      id: ID,
    });
  });

  it('skips a row whose event_type is not a registered topic', () => {
    const result = canonicalizeOutboxRow(row({ eventType: 'mystery.event' }));
    expect(result).toEqual({
      kind: 'skipped',
      id: ID,
      reason: "unknown event_type 'mystery.event'",
    });
  });

  it('skips a row that cannot be made canonical with a readable reason', () => {
    const result = canonicalizeOutboxRow(row({ eventId: 'not-a-uuid', envelope: {} }));
    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason).toContain('id');
  });
});
