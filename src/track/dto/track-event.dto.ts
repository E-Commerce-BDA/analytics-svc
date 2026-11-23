import { z } from 'zod';
import { pageViewedPayloadSchema } from '@ecom/contracts';

/**
 * The client-facing beacon body. `timestamp` is optional on the wire: the
 * server stamps it so a wrong client clock cannot corrupt funnels. The rest of
 * the fields are the contract payload, so `.strict()` keeps unknown keys (and
 * therefore stray PII) out at the boundary.
 */
export const trackEventSchema = pageViewedPayloadSchema
  .omit({ timestamp: true })
  .extend({ timestamp: pageViewedPayloadSchema.shape.timestamp.optional() });

export type TrackEventDto = z.infer<typeof trackEventSchema>;
