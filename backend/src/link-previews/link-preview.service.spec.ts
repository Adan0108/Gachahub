import {
  BadRequestException,
  ForbiddenException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { LinkPreviewService } from './link-preview.service';
import { PreviewUnavailableError } from './link-preview.resolver';
import type { LinkPreview } from './link-preview.types';
import { FetchFailedError } from './safe-fetcher';

jest.mock('../common/guards/active-user.util', () => ({
  loadActiveUser: jest.fn(),
}));
import { loadActiveUser } from '../common/guards/active-user.util';

const preview = (url: string): LinkPreview => ({
  url,
  domain: new URL(url).hostname,
  resolvedDomain: null,
  title: 'A page',
  description: null,
  siteName: null,
  image: null,
});

describe('LinkPreviewService', () => {
  const rateLimiter = { assertNotRateLimited: jest.fn() };
  const cache = {
    get: jest.fn(),
    setPreview: jest.fn(),
    setFailure: jest.fn(),
  };
  const resolver = { resolve: jest.fn() };
  let service: LinkPreviewService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    (loadActiveUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    cache.get.mockResolvedValue(null);
    resolver.resolve.mockImplementation((url: URL) =>
      Promise.resolve(preview(url.href)),
    );
    service = new LinkPreviewService(
      {} as never,
      rateLimiter as never,
      cache as never,
      resolver as never,
    );
  });

  it('looks up a link, remembers the answer and returns it', async () => {
    const result = await service.getPreview(
      'user-1',
      'https://example.com/a#frag',
    );

    expect(result).toEqual(preview('https://example.com/a'));
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect((resolver.resolve.mock.calls[0] as [URL])[0].href).toBe(
      'https://example.com/a',
    );
    expect(cache.setPreview).toHaveBeenCalledWith(
      'https://example.com/a',
      preview('https://example.com/a'),
    );
  });

  it('checks the account is active and within its rate limit first', async () => {
    (loadActiveUser as jest.Mock).mockRejectedValue(new ForbiddenException());

    await expect(
      service.getPreview('user-1', 'https://example.com/'),
    ).rejects.toThrow(ForbiddenException);
    expect(resolver.resolve).not.toHaveBeenCalled();

    (loadActiveUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    rateLimiter.assertNotRateLimited.mockImplementation(() => {
      throw new RateLimitedException('slow down', 5);
    });

    await expect(
      service.getPreview('user-1', 'https://example.com/'),
    ).rejects.toThrow(RateLimitedException);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(rateLimiter.assertNotRateLimited).toHaveBeenCalledWith('user-1');
  });

  it.each([
    ['an internal address', 'http://169.254.169.254/'],
    ['loopback', 'http://localhost/'],
    ['a private network', 'http://10.0.0.1/'],
    ['a file link', 'file:///etc/passwd'],
    ['something that is not a link', 'hello there'],
    ['credentials in the link', 'https://user:pass@example.com/'],
  ])('refuses %s without fetching anything', async (_name, raw) => {
    await expect(service.getPreview('user-1', raw)).rejects.toThrow(
      BadRequestException,
    );

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  describe('the cache', () => {
    it('answers from a stored preview without fetching', async () => {
      cache.get.mockResolvedValue({
        ok: true,
        preview: preview('https://example.com/'),
      });

      await expect(
        service.getPreview('user-1', 'https://example.com/'),
      ).resolves.toEqual(preview('https://example.com/'));
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('answers from a stored failure without fetching again', async () => {
      cache.get.mockResolvedValue({ ok: false });

      await expect(
        service.getPreview('user-1', 'https://example.com/'),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('looks links up by their normalised form', async () => {
      await service.getPreview('user-1', '  https://example.com/a#x  ');

      expect(cache.get).toHaveBeenCalledWith('https://example.com/a');
    });
  });

  describe('when no preview can be had', () => {
    it.each([
      ['the page cannot be fetched', new FetchFailedError('down')],
      ['the page has nothing to show', new PreviewUnavailableError()],
      [
        'the name resolves to an internal address',
        Object.assign(new Error('x'), { name: 'UnsafeUrlError' }),
      ],
      ['something unexpected happens', new TypeError('boom')],
    ])(
      'gives the same answer when %s, and remembers it briefly',
      async (_name, error) => {
        resolver.resolve.mockRejectedValue(error);

        const failure = await service
          .getPreview('user-1', 'https://example.com/x')
          .catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(UnprocessableEntityException);
        expect((failure as Error).message).toBe(
          'No preview is available for that link',
        );
        expect(cache.setFailure).toHaveBeenCalledWith('https://example.com/x');
        expect(cache.setPreview).not.toHaveBeenCalled();
      },
    );

    it('logs only the host, never the rest of the link', async () => {
      resolver.resolve.mockRejectedValue(new FetchFailedError('down'));

      await service
        .getPreview('user-1', 'https://example.com/magic?token=hunter2')
        .catch(() => undefined);

      const logged = warn.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .join(' ');
      expect(logged).toContain('example.com');
      expect(logged).not.toContain('hunter2');
      expect(logged).not.toContain('magic');
    });
  });

  describe('many people asking at once', () => {
    it('shares one fetch between everyone asking about the same link', async () => {
      let finish: (value: LinkPreview) => void = () => undefined;
      resolver.resolve.mockReturnValue(
        new Promise<LinkPreview>((resolve) => (finish = resolve)),
      );

      const first = service.getPreview('user-1', 'https://example.com/same');
      const second = service.getPreview('user-2', 'https://example.com/same');
      await new Promise((resolve) => setImmediate(resolve));
      finish(preview('https://example.com/same'));

      await expect(Promise.all([first, second])).resolves.toEqual([
        preview('https://example.com/same'),
        preview('https://example.com/same'),
      ]);
      expect(resolver.resolve).toHaveBeenCalledTimes(1);
    });

    it('fetches again for the same link once the first fetch is over', async () => {
      await service.getPreview('user-1', 'https://example.com/again');
      await service.getPreview('user-1', 'https://example.com/again');

      expect(resolver.resolve).toHaveBeenCalledTimes(2);
    });

    it('does not share a failure with the next, later request', async () => {
      resolver.resolve.mockRejectedValueOnce(new FetchFailedError('down'));

      await expect(
        service.getPreview('user-1', 'https://example.com/flaky'),
      ).rejects.toThrow(UnprocessableEntityException);
      await expect(
        service.getPreview('user-1', 'https://example.com/flaky'),
      ).resolves.toBeDefined();
    });

    it('turns away new fetches beyond eight at once, without caching that as a failure', async () => {
      resolver.resolve.mockReturnValue(new Promise(() => undefined));
      for (let i = 0; i < 8; i += 1) {
        void service.getPreview('user-1', `https://example.com/busy-${i}`);
      }
      await new Promise((resolve) => setImmediate(resolve));

      await expect(
        service.getPreview('user-2', 'https://example.com/ninth'),
      ).rejects.toThrow(RateLimitedException);
      expect(cache.setFailure).not.toHaveBeenCalledWith(
        'https://example.com/ninth',
      );
    });
  });
});
