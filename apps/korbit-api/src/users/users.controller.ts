import { BadRequestException, Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { createWriteStream } from 'fs';
import { mkdir, stat, unlink } from 'fs/promises';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.sub, dto);
  }

  @Post('me/avatar')
  async uploadAvatar(@CurrentUser() user: JwtPayload, @Req() request: FastifyRequest) {
    const part = await request.file();
    if (!part) {
      throw new BadRequestException('Файл не передан');
    }
    if (!part.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Можно загружать только изображения');
    }

    const maxSize = Number(
      this.configService.get<string>('MAX_UPLOAD_SIZE', `${10 * 1024 * 1024}`),
    );
    const uploadDir = this.configService.get<string>('UPLOAD_DIR', 'uploads');
    const uploadRoot = join(process.cwd(), uploadDir);
    const uploadPublicPrefix = this.configService.get<string>(
      'UPLOAD_PUBLIC_PREFIX',
      '/uploads',
    );
    await mkdir(uploadRoot, { recursive: true });

    const extension = extname(part.filename || '').toLowerCase() || '.jpg';
    const storageFileName = `avatar_${Date.now()}_${randomUUID()}${extension}`;
    const destination = join(uploadRoot, storageFileName);

    await pipeline(part.file, createWriteStream(destination));
    const uploaded = await stat(destination);
    if (uploaded.size > maxSize) {
      await unlink(destination).catch(() => undefined);
      throw new BadRequestException('Файл превышает максимально допустимый размер');
    }

    const avatarUrl = `${uploadPublicPrefix.replace(/\/$/, '')}/${storageFileName}`;
    return this.usersService.updateAvatar(user.sub, avatarUrl);
  }
}
