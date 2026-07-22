jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => () => undefined,
}));

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok health status with redis status and timestamp', async () => {
    const redisService = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    const controller = new HealthController(redisService as any);

    const result = await controller.check();

    expect(redisService.ping).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(result.services.redis).toBe('up');
    expect(result.timestamp).toEqual(expect.any(String));
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });
});
