import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { IndexesService } from './indexes.service.js';

/**
 * The single Mongo connection for the service. Analytics is append-only and
 * does not use Mongo transactions yet (anl-003 will), but the local URI points
 * at the `rs0` replica set so that transaction support needs no later change.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
        appName: 'analytics-svc',
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 10000,
        maxPoolSize: 10,
        // Boot must fail instead of silently running with no database.
        retryAttempts: 0,
      }),
    }),
  ],
  providers: [IndexesService],
  exports: [MongooseModule],
})
export class DbModule {}
