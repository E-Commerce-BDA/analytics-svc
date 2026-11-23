import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({ page: z.enum(['/home']) }).strict();

describe('ZodValidationPipe', () => {
  it('returns the parsed value when valid', () => {
    expect(new ZodValidationPipe(schema).transform({ page: '/home' })).toEqual({
      page: '/home',
    });
  });

  it('rejects with a field name and never echoes the value', () => {
    let error: unknown;
    try {
      new ZodValidationPipe(schema).transform({
        page: '/home?token=secret',
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      code: string;
      details: Array<{ field: string; message: string }>;
    };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details[0].field).toBe('page');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body.details[0].message).toBe('Invalid value');
  });
});
