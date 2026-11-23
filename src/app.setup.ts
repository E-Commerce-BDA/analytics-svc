import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Shared HTTP setup for the production bootstrap and the e2e suites, so global
 * behaviour cannot drift between them. The health routes stay outside the API
 * prefix because probes are called by infrastructure, not clients.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('/api/v1', {
    exclude: ['health', 'health/ready'],
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.getHttpAdapter().getInstance().disable('x-powered-by');
}
