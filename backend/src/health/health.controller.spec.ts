jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => () => undefined,
}));

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok health status with timestamp', () => {
    const controller = new HealthController();

    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.timestamp).toEqual(expect.any(String));
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });
});
