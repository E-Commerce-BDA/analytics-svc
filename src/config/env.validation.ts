import Joi from 'joi';

/**
 * Environment contract for analytics-svc.
 *
 * Every variable is either defaulted or explicitly required so a bad deploy
 * fails at boot with a named reason instead of silently collecting nothing.
 * `MONGODB_URI` is the only hard requirement: without a database this service
 * has no purpose, so starting it would only produce a green process with no
 * data. Kafka brokers are defaulted because the HTTP beacon must keep working
 * when the broker is down; the consumer can be parked with
 * KAFKA_CONSUMER_ENABLED without touching the API.
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
  KAFKA_CONSUMER_ENABLED: Joi.string().valid('true', 'false').default('true'),
  // anl-004: an active cart with no cart.updated for this long is abandoned.
  CART_ABANDONED_AFTER_MS: Joi.number().integer().min(60_000).default(30 * 60 * 1000),
  ABANDONMENT_SWEEP_ENABLED: Joi.string().valid('true', 'false').default('true'),
  ABANDONMENT_SWEEP_BATCH_SIZE: Joi.number().integer().min(1).max(1000).default(100),
  TRACK_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(60),
  TRACK_RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60_000),
  // Set by the e2e config so the relay never publishes during a test.
  DISABLE_OUTBOX_RELAY: Joi.string().valid('true', 'false').optional(),
});
