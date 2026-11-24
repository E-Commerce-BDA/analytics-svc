import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { startEventConsumer } from './consumer/consumer-runtime.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const configService = app.get(ConfigService);
  const port = Number(configService.getOrThrow<string>('PORT'));
  await app.listen(port, '0.0.0.0');

  // Deliberately not awaited: beacon ingestion answers as soon as the API is
  // listening, and a broker that is down only delays facts. The consumer
  // retries every five seconds and never rejects.
  void startEventConsumer(app, configService);
}

await bootstrap();
