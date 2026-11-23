import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';

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
    HealthModule,
  ],
})
export class AppModule {}
