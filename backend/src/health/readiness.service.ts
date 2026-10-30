import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ReadinessService {
  private probe?: Promise<{ status: string }>;
  private expiresAt = 0;

  constructor(
    private readonly db: PrismaService,
    private readonly kafka: KafkaProducerService,
    private readonly redis: RedisService,
  ) {}

  ready() {
    // Cache successes and failures; concurrent callers share the same bounded probe.
    if (!this.probe || Date.now() >= this.expiresAt) {
      this.expiresAt = Infinity;
      this.probe = this.check().finally(() => {
        this.expiresAt = Date.now() + 1000;
      });
    }
    return this.probe;
  }

  pingRedis() {
    return this.bounded(() => this.redis.ping());
  }

  private async check() {
    try {
      if (!this.kafka.isConnected) throw new Error('Dependency unavailable');
      await Promise.all([
        this.bounded(() => this.db.$queryRaw`SELECT 1`),
        this.pingRedis(),
      ]);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Required services are not ready');
    }
  }

  private async bounded<T>(operation: () => PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Dependency timeout')),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
