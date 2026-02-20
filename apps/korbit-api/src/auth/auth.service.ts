import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginAttemptsService } from './login-attempts.service';

type SessionMeta = {
  ipAddress?: string;
  userAgent?: string;
};

type RefreshPayload = {
  sub: string;
  sessionId: string;
  type: 'refresh';
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly loginAttemptsService: LoginAttemptsService,
  ) {}

  async register(dto: RegisterDto, meta: SessionMeta) {
    const registrationMode = this.configService.get<string>(
      'REGISTRATION_MODE',
      'invite',
    );

    if (registrationMode === 'admin_only') {
      throw new ForbiddenException('Self-registration is disabled');
    }

    this.assertPasswordPolicy(dto.password);
    const username = this.normalizeUsername(dto.username);
    const displayName = dto.displayName?.trim() || username;
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    let user: Prisma.UserGetPayload<Record<string, never>>;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        if (registrationMode === 'invite') {
          const inviteCode = dto.inviteCode?.trim();
          if (!inviteCode) {
            throw new BadRequestException('Invite code is required');
          }

          const invite = await tx.invite.findUnique({
            where: { code: inviteCode },
          });
          if (!invite || invite.disabledAt) {
            throw new ForbiddenException('Invite is not valid');
          }
          if (invite.expiresAt && invite.expiresAt < new Date()) {
            throw new ForbiddenException('Invite expired');
          }
          if (invite.usesCount >= invite.maxUses) {
            throw new ForbiddenException('Invite exhausted');
          }

          await tx.invite.update({
            where: { id: invite.id },
            data: { usesCount: { increment: 1 } },
          });
        }

        return tx.user.create({
          data: {
            username,
            displayName,
            passwordHash,
            role: UserRole.USER,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }

    return this.createSessionWithTokens(user, meta);
  }

  async login(dto: LoginDto, meta: SessionMeta) {
    const username = this.normalizeUsername(dto.username);
    const attemptKey = `${username}:${meta.ipAddress ?? 'unknown'}`;

    this.loginAttemptsService.assertCanAttempt(attemptKey);

    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      this.loginAttemptsService.registerFailure(attemptKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      this.loginAttemptsService.registerFailure(attemptKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.loginAttemptsService.registerSuccess(attemptKey);
    return this.createSessionWithTokens(user, meta);
  }

  async refresh(refreshToken: string, meta: SessionMeta) {
    const payload = await this.verifyRefreshToken(refreshToken);

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is expired');
    }

    const isValid = await argon2.verify(session.refreshTokenHash, refreshToken);
    if (!isValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.issueTokens(
      {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
      },
      session.user,
    );

    const refreshTokenHash = await argon2.hash(tokens.refreshToken, {
      type: argon2.argon2id,
    });

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash,
        userAgent: meta.userAgent ?? session.userAgent,
        ipAddress: meta.ipAddress ?? session.ipAddress,
      },
    });

    return {
      ...tokens,
      user: this.toUserDto(session.user),
    };
  }

  async logout(refreshToken: string) {
    const payload = await this.verifyRefreshToken(refreshToken);
    await this.prisma.session.updateMany({
      where: { id: payload.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private async createSessionWithTokens(
    user: Prisma.UserGetPayload<Record<string, never>>,
    meta: SessionMeta,
  ) {
    try {
      const refreshTtlSeconds = this.getRefreshTtlSeconds();
      const session = await this.prisma.session.create({
        data: {
          userId: user.id,
          refreshTokenHash: 'pending',
          expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });

      const tokens = await this.issueTokens(session, user);
      const refreshTokenHash = await argon2.hash(tokens.refreshToken, {
        type: argon2.argon2id,
      });

      await this.prisma.session.update({
        where: { id: session.id },
        data: { refreshTokenHash },
      });

      return {
        ...tokens,
        user: this.toUserDto(user),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }
  }

  private async issueTokens(
    session: { id: string; userId: string; expiresAt: Date },
    user: { id: string; username: string; role: UserRole },
  ) {
    const accessTtlSeconds = this.getAccessTtlSeconds();
    const refreshTtlSeconds = this.getRefreshTtlSeconds();

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        sessionId: session.id,
      },
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtlSeconds,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        sessionId: session.id,
        type: 'refresh',
      },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtlSeconds,
      },
    );

    return {
      accessToken,
      refreshToken,
      accessTokenTtl: accessTtlSeconds,
      refreshTokenTtl: refreshTtlSeconds,
    };
  }

  private async verifyRefreshToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token type');
      }
      return payload;
    } catch (error) {
      this.logger.warn(`Refresh token verification failed: ${String(error)}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private assertPasswordPolicy(password: string) {
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasDigit = /\d/.test(password);
    if (password.length < 10 || !hasUpper || !hasLower || !hasDigit) {
      throw new BadRequestException(
        'Password must be at least 10 symbols and include upper/lower case letters and numbers',
      );
    }
  }

  private normalizeUsername(username: string) {
    return username.trim().toLowerCase();
  }

  private getAccessTtlSeconds() {
    return Number(this.configService.get<string>('JWT_ACCESS_TTL', '900'));
  }

  private getRefreshTtlSeconds() {
    return Number(this.configService.get<string>('JWT_REFRESH_TTL', '2592000'));
  }

  private toUserDto(user: {
    id: string;
    username: string;
    role: UserRole;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
  }) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
    };
  }
}
