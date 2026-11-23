import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { IndexesService } from './indexes.service.js';
import { MongoConnectionBinder } from './mongo-connection.js';
import { MongoTransactions } from './mongo-tx.js';

/**
 * The single Mongo connection for the service. Analytics is append-only; the
 * local URI points at the `rs0` replica set so transactions (outbox writes and,
 * later, fact + dedupe) work without a URI change.
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
        retryAttempts: 0,
      }),
    }),
  ],
  providers: [MongoConnectionBinder, MongoTransactions, IndexesService],
  exports: [MongooseModule, MongoTransactions],
})
export class DbModule {}
