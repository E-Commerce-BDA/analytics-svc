import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { EventsModule } from './consumer/events.module.js';
import { AnalyticsOutboxModule } from './outbox/analytics-outbox.module.js';
import { TrackModule } from './track/track.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        libraryOptions: { abortEarly: false, allowUnknown: true },
      },
    }),
    DbModule,
    // Every mutation writes its event into analytics_outbox in the same
    // transaction; the relay publishes it afterwards. The consumer is a
    // separate module on its own group so a broker outage cannot block beacons.
    AnalyticsOutboxModule,
    EventsModule,
    HealthModule,
    TrackModule,
  ],
})
export class AppModule {}
