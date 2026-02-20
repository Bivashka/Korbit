import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN', 'http://localhost:3000');

  await app.register(helmet);
  await app.register(cors, {
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);

  const port = Number(configService.get<string>('PORT', '4000'));
  await app.listen(port, '0.0.0.0');

  Logger.log(`Korbit API listening on port ${port}`, 'Bootstrap');
}

bootstrap();
