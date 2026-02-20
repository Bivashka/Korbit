import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { mkdir } from 'fs/promises';
import { join } from 'path';
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

  const maxUploadSize = Number(
    configService.get<string>('MAX_UPLOAD_SIZE', `${10 * 1024 * 1024}`),
  );
  await app.register(multipart, {
    limits: {
      fileSize: maxUploadSize,
      files: 1,
    },
  });

  const uploadDir = configService.get<string>('UPLOAD_DIR', 'uploads');
  const uploadRoot = join(process.cwd(), uploadDir);
  await mkdir(uploadRoot, { recursive: true });

  await app.register(fastifyStatic, {
    root: uploadRoot,
    prefix: '/uploads/',
  });

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);

  const port = Number(configService.get<string>('PORT', '4000'));
  await app.listen(port, '0.0.0.0');

  Logger.log(`Korbit API listening on port ${port}`, 'Bootstrap');
}

bootstrap();
