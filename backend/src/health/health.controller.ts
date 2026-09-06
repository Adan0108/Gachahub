import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { RedisService } from '../redis/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly redisService: RedisService) {}

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
    await this.redisService.ping();

    return {
      status: 'ok',
      services: {
        redis: 'up',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
