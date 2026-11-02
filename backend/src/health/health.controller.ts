import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { ReadinessService } from './readiness.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly readinessService: ReadinessService) {}

  @Get('readiness')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Check required backend dependencies' })
  ready() {
    return this.readinessService.ready();
  }

  @Get()
  @AllowAnonymous()
  @ApiOperation({ summary: 'Check backend health status' })
  async check(): Promise<{
    status: 'ok';
    services: {
      redis: 'up';
    };
    timestamp: string;
  }> {
    await this.readinessService.pingRedis();

    return {
      status: 'ok',
      services: {
        redis: 'up',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
