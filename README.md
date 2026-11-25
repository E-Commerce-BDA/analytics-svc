# analytics-svc

Behavioral analytics for the storefront: page views, funnel facts, and the
idle-cart detector. Owns `page.viewed` and `cart.abandoned`; consumes
`cart.updated`, `order.created`, `page.viewed`, and `user.registered`. No SQS
tasks, no admin API.

Port **4060**. Local infra lives in `../ecom-infra/docker-compose.yml`.

## Gates

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:e2e   # needs Mongo; skips cleanly when it is down
pnpm lint
pnpm build
```

## Contracts 2.0.0 cutover: outbox backfill

`@ecom/contracts` 2.0.0 requires `type`, `version` and `idempotencyKey` in every
event envelope and rejects the 1.x `topic`/`eventType` aliases; `@ecom/messaging`
0.6.0 emits only that canonical shape for **new** rows. The relay publishes a
stored envelope verbatim, so any **`status: "pending"` row** left in
`analytics_outbox` from before the cutover would be dead-lettered by a 2.0.0
consumer. Rewrite those rows once, with the service stopped so the relay cannot
claim them mid-migration:

```bash
pnpm build
node --env-file=.env dist/outbox/outbox-backfill.cli.js --dry-run   # inspect first
pnpm backfill:outbox                                               # then apply
```

The CLI reads the row's own `event_type` column as the topic (it never trusts
an envelope alias), fills `version: 1` and `idempotencyKey` from the event id
when they are absent, recovers `timestamp` from `created_at`, and validates the
result against the 2.0.0 envelope schema before writing. Rows already canonical
are reported `unchanged`, so a re-run is a no-op; rows that cannot be made
canonical are reported with a reason and set a non-zero exit code. Published
and failed rows are never touched. `--collection` and `--batch` are optional.
The conversion rule is a pure, unit-tested function in
`src/outbox/outbox-backfill.ts`; the CLI is only Mongo wiring.

See `Documentation/services/analytics.md` for the full service spec.
