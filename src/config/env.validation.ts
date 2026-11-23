import Joi from 'joi';

/**
 * Environment contract for analytics-svc.
 *
 * Every variable is either defaulted or explicitly required so a bad deploy
 * fails at boot with a named reason instead of silently collecting nothing.
 * `MONGODB_URI` is the only hard requirement: without a database this service
 * has no purpose, so starting it would only produce a green process with no
 * data. Kafka brokers are optional here because anl-001 does not publish or
 * consume yet; anl-002 will make them required.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(4060),
  MONGODB_URI: Joi.string()
    .pattern(/^mongodb(\+srv)?:\/\/.+\/.+/)
    .required()
    .messages({
      'any.required': 'MONGODB_URI is required',
      'string.pattern.base':
        'MONGODB_URI must start with mongodb:// or mongodb+srv:// and include a database name',
    }),
  KAFKA_BROKERS: Joi.string().default('localhost:9092'),
  // Ingest rate limit. Defaults match the documented 60 events / 60s window.
  TRACK_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(60),
  TRACK_RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60_000),
  // Set by the e2e config so the relay never publishes during a test.
  DISABLE_OUTBOX_RELAY: Joi.string().valid('true', 'false').optional(),
});
