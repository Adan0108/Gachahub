import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { KafkaModule } from '../kafka/kafka.module';
import { ReadinessService } from './readiness.service';
import { HealthController } from './health.controller';

@Module({
  imports: [PrismaModule, RedisModule, KafkaModule],
  providers: [ReadinessService],
  controllers: [HealthController],
})
export class HealthModule {}
