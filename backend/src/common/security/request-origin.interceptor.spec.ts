import { of } from 'rxjs';
import { RequestOriginInterceptor } from './request-origin.interceptor';

describe('cookie write origin policy', () => {
  const original = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL =
      'https://trusted.example/,https://second.example';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original;
  });
  it.each([
    [{ cookie: 'session=x' }, false],
    [{ cookie: 'session=x', origin: 'null' }, false],
    [
      {
        cookie: 'session=x',
        origin: 'https://evil.example',
        referer: 'https://trusted.example/path',
      },
      false,
    ],
    [
      {
        cookie: 'session=x',
        origin: ['https://trusted.example', 'https://evil.example'],
      },
      false,
    ],
    [{ cookie: 'session=x', origin: 'https://trusted.example' }, true],
    [{ cookie: 'session=x', origin: 'https://second.example' }, true],
    [{ cookie: 'session=x', referer: 'https://trusted.example/path' }, true],
    [{ cookie: 'session=x', 'sec-fetch-site': 'cross-site' }, false],
    [{}, true],
  ])('validates request headers %j', async (headers, permitted) => {
    const next = { handle: jest.fn(() => of('allowed')) };
    const operation = Promise.resolve().then(() =>
      new RequestOriginInterceptor().intercept(
        {
          getType: () => 'http',
          switchToHttp: () => ({
            getRequest: () => ({
              user: { id: 'user' },
              method: 'POST',
              headers,
            }),
          }),
        } as never,
        next,
      ),
    );
    if (permitted) await expect(operation).resolves.toBeDefined();
    else {
      await expect(operation).rejects.toThrow('origin');
      expect(next.handle).not.toHaveBeenCalled();
    }
  });
});
