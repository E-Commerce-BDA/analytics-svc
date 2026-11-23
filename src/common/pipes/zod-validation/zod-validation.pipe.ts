import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Zod body validation with PII-safe error details.
 *
 * Copied from cms-svc but deliberately does NOT include the rejected value in
 * the error: a beacon carries a page URL, and an invalid one might contain a
 * token in its query string. Field names and a fixed message are enough to fix
 * the request without echoing what the shopper sent.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: 'Invalid value',
        })),
      });
    }
    return result.data;
  }
}
