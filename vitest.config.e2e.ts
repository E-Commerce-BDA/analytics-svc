import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // The outbox relay is decided when its module is imported, so the flag has
    // to exist before the app boots. e2e suites call drainOnce() by hand.
    env: { DISABLE_OUTBOX_RELAY: 'true' },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
