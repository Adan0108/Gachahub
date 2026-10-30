import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class ModerationReadinessController {
  constructor(
    private readonly db: PrismaService,
    private readonly kafka: KafkaProducerService,
    private readonly redis: RedisService,
  ) {}
  @Get('readiness')
  @AllowAnonymous()
  async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      await this.redis.ping();
      if (!this.kafka.isConnected) throw new Error('Dependency unavailable');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Required services are not ready');
    }
  }
}
