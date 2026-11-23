import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrackController } from './track.controller.js';
import { TrackService } from './track.service.js';
import { SlidingWindowLimiter } from './rate-limit.js';
import { TRACK_LIMITER } from './track.tokens.js';

/** The HTTP ingest boundary for storefront page-view beacons. */
@Module({
  controllers: [TrackController],
  providers: [
    TrackService,
    {
      provide: TRACK_LIMITER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SlidingWindowLimiter({
          maxEvents: Number(config.get('TRACK_RATE_LIMIT_MAX') ?? 60),
          windowMs: Number(config.get('TRACK_RATE_LIMIT_WINDOW_MS') ?? 60_000),
          maxSessions: 10_000,
        }),
    },
  ],
})
export class TrackModule {}
