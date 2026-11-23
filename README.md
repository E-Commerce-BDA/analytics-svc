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

See `Documentation/services/analytics.md` for the full service spec.
