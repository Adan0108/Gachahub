jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => () => undefined,
}));
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { Test } from '@nestjs/testing';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { HealthController } from './health.controller';
import { HealthModule } from './health.module';
import { ReadinessService } from './readiness.service';

describe('HealthController', () => {
  it('resolves the health module without importing enforcement', async () => {
    const module = await Test.createTestingModule({ imports: [HealthModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue({})
      .overrideProvider(REDIS_CLIENT)
      .useValue({ isOpen: false })
      .overrideProvider(KafkaProducerService)
      .useValue({})
      .compile();
    expect(module.get(HealthController)).toBeInstanceOf(HealthController);
    expect(module.get(ReadinessService)).toBeInstanceOf(ReadinessService);
    await module.close();
  });

  it('retains both distinct routes on the health controller', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HealthController)).toBe('health');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        Object.getOwnPropertyDescriptor(HealthController.prototype, 'check')!
          .value as object,
      ),
    ).toBe('/');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        Object.getOwnPropertyDescriptor(HealthController.prototype, 'ready')!
          .value as object,
      ),
    ).toBe('readiness');
  });
  it('delegates readiness without changing its response', async () => {
    const readiness = {
      ready: jest.fn().mockResolvedValue({ status: 'ready' }),
    };
    const controller = new HealthController(readiness as never);
    await expect(controller.ready()).resolves.toEqual({ status: 'ready' });
    expect(readiness.ready).toHaveBeenCalledTimes(1);
  });
  it('returns ok health status with redis status and timestamp', async () => {
    const redisService = {
      pingRedis: jest.fn().mockResolvedValue('PONG'),
    };

    const controller = new HealthController(redisService as never);

    const result = await controller.check();

    expect(redisService.pingRedis).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(result.services.redis).toBe('up');
    expect(result.timestamp).toEqual(expect.any(String));
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });
});
