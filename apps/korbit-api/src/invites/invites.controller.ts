import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { CreateInviteDto } from './dto/create-invite.dto';
import { InvitesService } from './invites.service';

@Controller('invites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post()
  createInvite(@CurrentUser() user: JwtPayload, @Body() dto: CreateInviteDto) {
    return this.invitesService.createInvite(user.sub, dto);
  }

  @Get()
  listInvites() {
    return this.invitesService.listInvites();
  }

  @Patch(':inviteId/disable')
  disableInvite(@Param('inviteId') inviteId: string) {
    return this.invitesService.disableInvite(inviteId);
  }
}

