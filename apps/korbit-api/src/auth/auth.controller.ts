import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() request: FastifyRequest) {
    return this.authService.register(dto, this.extractMeta(request));
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: FastifyRequest) {
    return this.authService.login(dto, this.extractMeta(request));
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() request: FastifyRequest) {
    return this.authService.refresh(dto.refreshToken, this.extractMeta(request));
  }

  @Public()
  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: JwtPayload) {
    return this.authService.logoutAll(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('session')
  getSession(@CurrentUser() user: JwtPayload) {
    return {
      user,
    };
  }

  private extractMeta(request: FastifyRequest) {
    const userAgentHeader = request.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader.join('; ')
      : userAgentHeader;

    return {
      ipAddress: request.ip,
      userAgent,
    };
  }
}

