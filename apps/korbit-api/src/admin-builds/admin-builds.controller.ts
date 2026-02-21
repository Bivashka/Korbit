import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import {
  AdminBuildsService,
  BuildTarget,
  SUPPORTED_BUILD_TARGETS,
} from './admin-builds.service';

function isBuildTarget(value: string): value is BuildTarget {
  return SUPPORTED_BUILD_TARGETS.includes(value as BuildTarget);
}

@Controller('admin/builds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminBuildsController {
  constructor(private readonly adminBuildsService: AdminBuildsService) {}

  @Get()
  listBuilds() {
    return this.adminBuildsService.getBuildOverview();
  }

  @Post(':target')
  triggerBuild(
    @CurrentUser() user: JwtPayload,
    @Param('target') target: string,
  ) {
    if (!isBuildTarget(target)) {
      throw new BadRequestException(
        `Unknown build target. Use: ${SUPPORTED_BUILD_TARGETS.join(', ')}`,
      );
    }
    return this.adminBuildsService.triggerBuild(target, user.sub);
  }
}

