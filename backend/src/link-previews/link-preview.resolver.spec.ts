import {
  LinkPreviewResolver,
  PreviewUnavailableError,
} from './link-preview.resolver';
import {
  FetchFailedError,
  type FetchedPage,
  type FetchRequest,
  type SafeFetcher,
} from './safe-fetcher';
import { UnsafeUrlError } from './ssrf/url-policy';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const page = (
  url: string,
  contentType: string,
  body: Buffer | string,
  extra: Partial<FetchedPage> = {},
): FetchedPage => ({
  url: new URL(url),
  contentType,
  bytes: Buffer.isBuffer(body) ? body : Buffer.from(body),
  truncated: false,
  ...extra,
});

const htmlPage = (
  url: string,
  head: string,
  extra: Partial<FetchedPage> = {},
) =>
  page(
    url,
    'text/html',
    `<html><head>${head}</head><body></body></html>`,
    extra,
  );

describe('LinkPreviewResolver', () => {
  const fetch = jest.fn<Promise<FetchedPage>, [string, FetchRequest]>();
  const resolver = new LinkPreviewResolver({ fetch } as unknown as SafeFetcher);

  const respond = (answers: Record<string, FetchedPage | Error>) => {
    fetch.mockImplementation((url) => {
      const answer = answers[url];
      if (answer === undefined)
        return Promise.reject(new FetchFailedError('no such page'));
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    });
  };

  beforeEach(() => fetch.mockReset());

  describe('an ordinary page', () => {
    it('shows what the page says about itself, with its picture', async () => {
      respond({
        'https://example.com/post': htmlPage(
          'https://example.com/post',
          `<meta property="og:title" content="A Post">
           <meta property="og:description" content="About a thing">
           <meta property="og:site_name" content="Example">
           <meta property="og:image" content="https://cdn.example.com/cover.png">`,
        ),
        'https://cdn.example.com/cover.png': page(
          'https://cdn.example.com/cover.png',
          'image/png',
          PNG,
        ),
      });

      const preview = await resolver.resolve(
        new URL('https://example.com/post'),
      );

      expect(preview).toEqual({
        url: 'https://example.com/post',
        domain: 'example.com',
        resolvedDomain: null,
        title: 'A Post',
        description: 'About a thing',
        siteName: 'Example',
        image: { mime: 'image/png', data: PNG.toString('base64') },
      });
    });

    it('asks for html, allows a truncated read, and refuses types it cannot use', async () => {
      respond({
        'https://example.com/': htmlPage(
          'https://example.com/',
          '<title>Hi</title>',
        ),
      });

      await resolver.resolve(new URL('https://example.com/'));

      const request = fetch.mock.calls[0][1];
      expect(request.truncate).toBe(true);
      expect(request.limitFor('text/html')).toBe(512 * 1024);
      expect(request.limitFor('application/xhtml+xml')).toBe(512 * 1024);
      expect(request.limitFor('image/png')).toBe(1_000_000);
      expect(request.limitFor('application/zip')).toBeNull();
      expect(request.limitFor('application/json')).toBeNull();
    });

    it('is fine with a card that has a title and no picture', async () => {
      respond({
        'https://example.com/': htmlPage(
          'https://example.com/',
          '<title>Just text</title>',
        ),
      });

      const preview = await resolver.resolve(new URL('https://example.com/'));

      expect(preview).toMatchObject({
        title: 'Just text',
        image: null,
        description: null,
        siteName: null,
      });
    });

    it('shows a picture alone when the page has no title', async () => {
      respond({
        'https://example.com/': htmlPage(
          'https://example.com/',
          '<meta property="og:image" content="/c.jpg">',
        ),
        'https://example.com/c.jpg': page(
          'https://example.com/c.jpg',
          'image/jpeg',
          JPEG,
        ),
      });

      const preview = await resolver.resolve(new URL('https://example.com/'));

      expect(preview.title).toBeNull();
      expect(preview.image?.mime).toBe('image/jpeg');
    });

    it('has nothing to show for a page with no title and no picture', async () => {
      respond({
        'https://example.com/': htmlPage(
          'https://example.com/',
          '<meta name="description" content="only this">',
        ),
      });

      await expect(
        resolver.resolve(new URL('https://example.com/')),
      ).rejects.toThrow(PreviewUnavailableError);
    });

    it('reads the page in the charset it declares', async () => {
      respond({
        'https://example.com/': page(
          'https://example.com/',
          'text/html',
          Buffer.from('<head><title>Café</title></head>', 'latin1'),
          { charset: 'iso-8859-1' },
        ),
      });

      expect(
        (await resolver.resolve(new URL('https://example.com/'))).title,
      ).toBe('Café');
    });

    it('finds the charset in the page when the headers do not say', async () => {
      respond({
        'https://example.com/': page(
          'https://example.com/',
          'text/html',
          Buffer.from(
            '<head><meta charset="windows-1252"><title>Café</title></head>',
            'latin1',
          ),
        ),
      });

      expect(
        (await resolver.resolve(new URL('https://example.com/'))).title,
      ).toBe('Café');
    });

    it('falls back to utf-8 for a charset it does not know', async () => {
      respond({
        'https://example.com/': page(
          'https://example.com/',
          'text/html',
          '<head><title>Fine</title></head>',
          {
            charset: 'x-made-up',
          },
        ),
      });

      expect(
        (await resolver.resolve(new URL('https://example.com/'))).title,
      ).toBe('Fine');
    });

    it('lets a failure to fetch the page itself through', async () => {
      respond({ 'https://example.com/': new FetchFailedError('down') });

      await expect(
        resolver.resolve(new URL('https://example.com/')),
      ).rejects.toThrow(FetchFailedError);
    });

    it('lets a refused address through, so it can be told apart', async () => {
      respond({ 'https://example.com/': new UnsafeUrlError('internal') });

      await expect(
        resolver.resolve(new URL('https://example.com/')),
      ).rejects.toThrow(UnsafeUrlError);
    });
  });

  describe('redirects', () => {
    it('says where a short link really leads', async () => {
      respond({
        'https://short.example/abc': htmlPage(
          'https://destination.example/article',
          '<title>Article</title>',
        ),
      });

      const preview = await resolver.resolve(
        new URL('https://short.example/abc'),
      );

      expect(preview.domain).toBe('short.example');
      expect(preview.resolvedDomain).toBe('destination.example');
    });

    it('has no resolved domain when the link stays on its own site', async () => {
      respond({
        'https://example.com/a': htmlPage(
          'https://example.com/b',
          '<title>Moved within the site</title>',
        ),
      });

      expect(
        (await resolver.resolve(new URL('https://example.com/a')))
          .resolvedDomain,
      ).toBeNull();
    });
  });

  describe('a link that is a picture', () => {
    it('shows the picture alone', async () => {
      respond({
        'https://example.com/pic.png': page(
          'https://example.com/pic.png',
          'image/png',
          PNG,
        ),
      });

      const preview = await resolver.resolve(
        new URL('https://example.com/pic.png'),
      );

      expect(preview).toMatchObject({
        title: null,
        image: { mime: 'image/png', data: PNG.toString('base64') },
      });
    });

    it('trusts the bytes over the claimed type', async () => {
      respond({
        'https://example.com/pic': page(
          'https://example.com/pic',
          'image/png',
          JPEG,
        ),
      });

      expect(
        (await resolver.resolve(new URL('https://example.com/pic'))).image
          ?.mime,
      ).toBe('image/jpeg');
    });

    it.each([
      [
        'SVG',
        page(
          'https://example.com/p.svg',
          'image/svg+xml',
          '<svg><script>alert(1)</script></svg>',
        ),
      ],
      [
        'something that is not an image',
        page('https://example.com/p.png', 'image/png', '<html>nope</html>'),
      ],
      [
        'a picture cut off at the size limit',
        page('https://example.com/p.png', 'image/png', PNG, {
          truncated: true,
        }),
      ],
    ])('refuses %s', async (_name, answer) => {
      respond({ [answer.url.href]: answer });

      await expect(resolver.resolve(answer.url)).rejects.toThrow(
        PreviewUnavailableError,
      );
    });
  });

  describe("a page's own picture", () => {
    const head =
      '<meta property="og:title" content="T"><meta property="og:image" content="https://cdn.example.com/i">';
    const withImage = (image: FetchedPage | Error) => {
      respond({
        'https://example.com/': htmlPage('https://example.com/', head),
        'https://cdn.example.com/i': image,
      });
    };

    it('is read by what its bytes are, even when served as generic data', async () => {
      withImage(
        page('https://cdn.example.com/i', 'application/octet-stream', JPEG),
      );

      expect(
        (await resolver.resolve(new URL('https://example.com/'))).image?.mime,
      ).toBe('image/jpeg');
    });

    it('is only fetched as a picture, within the picture size limit', async () => {
      withImage(page('https://cdn.example.com/i', 'image/png', PNG));

      await resolver.resolve(new URL('https://example.com/'));

      const request = fetch.mock.calls[1][1];
      expect(request.accept).toBe('image/*');
      expect(request.limitFor('image/webp')).toBe(1_000_000);
      expect(request.limitFor('application/octet-stream')).toBe(1_000_000);
      expect(request.limitFor('text/html')).toBeNull();
    });

    it.each([
      ['it cannot be fetched', new FetchFailedError('down')],
      ['it points at an internal address', new UnsafeUrlError('internal')],
      [
        'it is SVG',
        page('https://cdn.example.com/i', 'image/svg+xml', '<svg></svg>'),
      ],
      [
        'it is not really an image',
        page('https://cdn.example.com/i', 'image/png', 'plain text'),
      ],
    ])(
      'is left out, and the card still shows, when %s',
      async (_name, answer) => {
        withImage(answer);

        const preview = await resolver.resolve(new URL('https://example.com/'));

        expect(preview).toMatchObject({ title: 'T', image: null });
      },
    );
  });

  describe('YouTube', () => {
    const link = 'https://www.youtube.com/watch?v=abc123';
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(link)}&format=json`;
    const oembed = (body: unknown) =>
      page(oembedUrl, 'application/json', JSON.stringify(body));

    it('uses the oEmbed answer, with the channel as the description', async () => {
      respond({
        [oembedUrl]: oembed({
          title: 'A video',
          author_name: 'A channel',
          provider_name: 'YouTube',
          thumbnail_url: 'https://i.ytimg.com/vi/abc123/hq.jpg',
        }),
        'https://i.ytimg.com/vi/abc123/hq.jpg': page(
          'https://i.ytimg.com/vi/abc123/hq.jpg',
          'image/jpeg',
          JPEG,
        ),
      });

      const preview = await resolver.resolve(new URL(link));

      expect(preview).toMatchObject({
        title: 'A video',
        description: 'A channel',
        siteName: 'YouTube',
        image: { mime: 'image/jpeg' },
      });
      expect(fetch.mock.calls.map(([url]) => url)).not.toContain(link);
    });

    it('only accepts a small JSON answer', async () => {
      respond({ [oembedUrl]: oembed({ title: 'A video' }) });

      await resolver.resolve(new URL(link));

      const request = fetch.mock.calls[0][1];
      expect(request.limitFor('application/json')).toBe(100 * 1024);
      expect(request.limitFor('text/html')).toBeNull();
    });

    it.each([
      ['it fails', new FetchFailedError('down')],
      ['it gives no title', undefined],
      ['it is not JSON', page(oembedUrl, 'application/json', 'not json')],
    ])(
      'falls back to the page itself when oEmbed %s',
      async (_name, answer) => {
        respond({
          [oembedUrl]:
            answer === undefined
              ? oembed({ author_name: 'only an author' })
              : answer,
          [link]: htmlPage(
            link,
            '<meta property="og:title" content="From the page">',
          ),
        });

        expect((await resolver.resolve(new URL(link))).title).toBe(
          'From the page',
        );
      },
    );
  });

  it('never asks oEmbed about other sites', async () => {
    respond({
      'https://example.com/': htmlPage(
        'https://example.com/',
        '<title>Hi</title>',
      ),
    });

    await resolver.resolve(new URL('https://example.com/'));

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
