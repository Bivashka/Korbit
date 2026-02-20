import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInviteDto } from './dto/create-invite.dto';

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvite(createdById: string, dto: CreateInviteDto) {
    const code = await this.generateInviteCode();

    return this.prisma.invite.create({
      data: {
        code,
        createdById,
        maxUses: dto.maxUses ?? 1,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
  }

  async listInvites() {
    return this.prisma.invite.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
  }

  async disableInvite(inviteId: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { id: inviteId },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    return this.prisma.invite.update({
      where: { id: inviteId },
      data: { disabledAt: new Date() },
    });
  }

  private async generateInviteCode() {
    for (let i = 0; i < 8; i += 1) {
      const candidate = randomBytes(6).toString('base64url').toUpperCase();
      const exists = await this.prisma.invite.findUnique({
        where: { code: candidate },
      });
      if (!exists) {
        return candidate;
      }
    }

    return `${Date.now().toString(36)}${randomBytes(4)
      .toString('hex')
      .toUpperCase()}`;
  }
}

