import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @AllowAnonymous()
  @ApiOperation({ summary: 'Check backend health status' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
