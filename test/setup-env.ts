// Applied by vitest.config.e2e.ts before any module is imported.
process.env.NODE_ENV ??= 'test';
process.env.MONGODB_URI ??=
  'mongodb://localhost:27018/ecom_analytics_test?replicaSet=rs0&directConnection=true';
process.env.KAFKA_BROKERS ??= 'localhost:9092';
process.env.DISABLE_OUTBOX_RELAY = 'true';
