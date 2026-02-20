import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const bootstrapEnabled = this.configService.get<string>(
      'ADMIN_BOOTSTRAP_ENABLED',
      'true',
    );
    if (bootstrapEnabled !== 'true') {
      return;
    }

    const username = this.configService.get<string>('ADMIN_USERNAME');
    const password = this.configService.get<string>('ADMIN_PASSWORD');

    if (!username || !password) {
      this.logger.warn(
        'Admin bootstrap skipped: ADMIN_USERNAME or ADMIN_PASSWORD is missing',
      );
      return;
    }

    if (password.length < 10) {
      this.logger.warn(
        'Admin bootstrap skipped: ADMIN_PASSWORD must be at least 10 symbols',
      );
      return;
    }

    const normalized = username.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { username: normalized },
    });
    if (existing) {
      return;
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.user.create({
      data: {
        username: normalized,
        passwordHash,
        displayName: 'Admin',
        role: UserRole.ADMIN,
      },
    });
    this.logger.log(`Bootstrap admin created: ${normalized}`);
  }
}

