import { eventEnvelopeSchema, isEventTopic, type EventEnvelope } from '@ecom/contracts';

/** One pending outbox document, narrowed to the fields the backfill reads. */
export interface OutboxBackfillRow {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly envelope: Record<string, unknown>;
  readonly createdAt?: Date;
}

export type OutboxBackfillResult =
  | { readonly kind: 'unchanged'; readonly id: string }
  | { readonly kind: 'updated'; readonly id: string; readonly envelope: EventEnvelope }
  | { readonly kind: 'skipped'; readonly id: string; readonly reason: string };

/**
 * Written by this service before the 2.0.0 cutover; a row with no producer is
 * still one of ours, so there is no other possible value to recover.
 */
const PRODUCER = 'analytics-svc';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rewrites one stored outbox envelope into the canonical 2.0.0 shape.
 *
 * The relay publishes the stored envelope verbatim, so a 1.x row left behind at
 * cutover is dead-lettered by every 2.0.0 consumer: `eventEnvelopeSchema` is now
 * strict and requires `type`, `version` and `idempotencyKey`. This is the only
 * place a legacy envelope is converted — the consumer never normalises one at
 * read time, or a producer that forgot the cutover would silently keep working.
 *
 * The row's `event_type` column, not an envelope alias, names the topic: it is
 * the outbox's own routing field and stays authoritative even when the stored
 * envelope has neither `type` nor `topic`. `id` and `created_at` are likewise
 * row-level facts. A row already canonical is left untouched, so re-running the
 * CLI is a no-op; a row that cannot be made canonical is skipped with a reason.
 */
export function canonicalizeOutboxRow(row: OutboxBackfillRow): OutboxBackfillResult {
  if (!isEventTopic(row.eventType)) {
    return { kind: 'skipped', id: row.id, reason: `unknown event_type '${row.eventType}'` };
  }

  const stored = isRecord(row.envelope) ? row.envelope : {};
  const current = eventEnvelopeSchema.safeParse(stored);
  if (current.success && current.data.type === row.eventType) {
    return { kind: 'unchanged', id: row.id };
  }

  const id = text(stored.id) ?? row.eventId;
  const candidate = {
    id,
    type: row.eventType,
    version: typeof stored.version === 'number' ? stored.version : 1,
    timestamp:
      text(stored.timestamp) ??
      (row.createdAt instanceof Date ? row.createdAt.toISOString() : undefined),
    producer: text(stored.producer) ?? PRODUCER,
    // 0.6.0's builder uses the event id as the idempotency key; recover the same
    // value rather than minting a new one that would double-apply on redelivery.
    idempotencyKey: text(stored.idempotencyKey) ?? id,
    payload: stored.payload,
  };

  const parsed = eventEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { kind: 'skipped', id: row.id, reason };
  }
  return { kind: 'updated', id: row.id, envelope: parsed.data };
}
