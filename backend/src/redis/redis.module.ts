import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

const redisClientProvider = {
  provide: REDIS_CLIENT,

  useFactory: async (): Promise<RedisClientType> => {
    const logger = new Logger('Redis');

    const client = createClient({
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    });

    client.on('error', (error: Error) => {
      logger.error('Redis connection error', error.stack);
    });

    client.on('ready', () => {
      logger.log('Redis connection ready');
    });

    await client.connect();

    return client;
  },
};

@Injectable()
class RedisShutdownService implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: RedisClientType,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }
}

@Global()
@Module({
  providers: [redisClientProvider, RedisService, RedisShutdownService],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
