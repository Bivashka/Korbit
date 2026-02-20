import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'korbit-api',
      timestamp: new Date().toISOString(),
    };
  }
}

