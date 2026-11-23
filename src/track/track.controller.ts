import {
  Controller,
  HttpCode,
  HttpStatus,
  Header,
  Inject,
  Post,
  Body,
  Res,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/pipes/zod-validation/zod-validation.pipe.js';
import { trackEventSchema, type TrackEventDto } from './dto/track-event.dto.js';
import { TrackService } from './track.service.js';
import { TRACK_LIMITER } from './track.tokens.js';
import type { SlidingWindowLimiter } from './rate-limit.js';

@Controller('track')
export class TrackController {
  constructor(
    private readonly trackService: TrackService,
    @Inject(TRACK_LIMITER) private readonly limiter: SlidingWindowLimiter,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  async track(
    @Body(new ZodValidationPipe(trackEventSchema)) dto: TrackEventDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ status: 'accepted' }> {
    const decision = this.limiter.check(dto.sessionId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      // The shared filter wraps this in the standard error envelope, with our
      // code intact so a client can tell a rate limit from a bad payload.
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many tracking events for this session',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.trackService.record(dto);
    return { status: 'accepted' };
  }
}
