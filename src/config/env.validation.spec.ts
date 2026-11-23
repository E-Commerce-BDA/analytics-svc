import { describe, expect, it } from 'vitest';
import { envValidationSchema } from './env.validation.js';

const uri = 'mongodb://localhost:27018/ecom_analytics?replicaSet=rs0';

describe('analytics env validation', () => {
  it('defaults the port and node environment', () => {
    const { value, error } = envValidationSchema.validate(
      { MONGODB_URI: uri },
      { abortEarly: false, allowUnknown: true },
    );
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(4060);
    expect(value.NODE_ENV).toBe('development');
    expect(value.KAFKA_BROKERS).toBe('localhost:9092');
  });

  it('requires a Mongo URI with a database name', () => {
    expect(
      envValidationSchema.validate({}, { abortEarly: false }).error?.message,
    ).toContain('MONGODB_URI is required');
    expect(
      envValidationSchema.validate(
        { MONGODB_URI: 'localhost:27017' },
        { abortEarly: false },
      ).error?.message,
    ).toContain('MONGODB_URI must start with');
  });

  it('rejects an unknown node environment', () => {
    expect(
      envValidationSchema.validate(
        { MONGODB_URI: uri, NODE_ENV: 'staging' },
        { abortEarly: false },
      ).error,
    ).toBeDefined();
  });
});
