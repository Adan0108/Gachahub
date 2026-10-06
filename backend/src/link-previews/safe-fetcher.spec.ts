import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import {
  FetchFailedError,
  SafeFetcher,
  STRICT_FETCH_POLICY,
  type FetchPolicy,
  type FetchRequest,
} from './safe-fetcher';
import { createSafeLookup } from './ssrf/safe-lookup';
import { parsePublicHttpUrl, UnsafeUrlError } from './ssrf/url-policy';

type Handler = Parameters<typeof createServer>[1];

interface Fixture {
  server: Server;
  origin: string;
  requests: number;
  headers: IncomingHttpHeaders[];
}

function listen(handler: Handler): Promise<Fixture> {
  return new Promise((resolve) => {
    const fixture = {
      requests: 0,
      headers: [] as IncomingHttpHeaders[],
    } as Fixture;
    fixture.server = createServer((request, response) => {
      fixture.requests += 1;
      fixture.headers.push(request.headers);
      (handler as NonNullable<Handler>)(request, response);
    });
    fixture.server.listen(0, '127.0.0.1', () => {
      fixture.origin = `http://127.0.0.1:${(fixture.server.address() as AddressInfo).port}`;
      testServerOrigins.add(fixture.origin);
      resolve(fixture);
    });
  });
}

/** The local test servers, which stand in for sites; every other address gets the real rules. */
const testServerOrigins = new Set<string>();

const onlyLocalServerIsAllowed: FetchPolicy = {
  parseUrl: (raw) => {
    const url = new URL(raw);
    return testServerOrigins.has(url.origin) ? url : parsePublicHttpUrl(raw);
  },
  lookup: createSafeLookup(() => Promise.resolve([])),
};

const html: FetchRequest = {
  accept: 'text/html',
  limitFor: (type) => (type === 'text/html' ? 1000 : null),
};

describe('SafeFetcher', () => {
  const fixtures: Fixture[] = [];
  const fetchers: SafeFetcher[] = [];

  const serve = async (handler: Handler) => {
    const fixture = await listen(handler);
    fixtures.push(fixture);
    return fixture;
  };
  const fetcherFor = (policy: FetchPolicy = onlyLocalServerIsAllowed) => {
    const fetcher = new SafeFetcher(policy);
    fetchers.push(fetcher);
    return fetcher;
  };

  afterEach(async () => {
    jest.restoreAllMocks();
    testServerOrigins.clear();
    await Promise.all(
      fetchers.splice(0).map((fetcher) => fetcher.onModuleDestroy()),
    );
    await Promise.all(
      fixtures.splice(0).map(
        ({ server }) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  });

  it('returns the body with its media type and charset', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(200, {
        'content-type': 'Text/HTML; Charset="ISO-8859-1"',
      });
      response.end('<p>hello</p>');
    });

    const page = await fetcherFor().fetch(`${site.origin}/page`, html);

    expect(page.contentType).toBe('text/html');
    expect(page.charset).toBe('iso-8859-1');
    expect(page.bytes.toString()).toBe('<p>hello</p>');
    expect(page.truncated).toBe(false);
    expect(page.url.href).toBe(`${site.origin}/page`);
  });

  it('introduces itself, asks for what it wants, and sends no cookies or credentials', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('ok');
    });

    await fetcherFor().fetch(`${site.origin}/`, html);

    const sent = site.headers[0];
    expect(sent['user-agent']).toBe('GachahubLinkPreview/1.0');
    expect(sent.accept).toBe('text/html');
    expect(sent.cookie).toBeUndefined();
    expect(sent.authorization).toBeUndefined();
  });

  it('follows a redirect and reports where the page really was', async () => {
    const site = await serve((request, response) => {
      if (request.url === '/short') {
        response.writeHead(301, { location: '/long' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('arrived');
    });

    const page = await fetcherFor().fetch(`${site.origin}/short`, html);

    expect(page.bytes.toString()).toBe('arrived');
    expect(page.url.pathname).toBe('/long');
  });

  it.each([
    ['cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['loopback on another port', 'http://127.0.0.1:6379/'],
    ['internal name', 'http://localhost/admin'],
    ['private network', 'http://10.0.0.5/'],
    ['file link', 'file:///etc/passwd'],
    ['IPv6 loopback', 'http://[::1]/'],
  ])(
    'refuses a redirect to the %s and never follows it',
    async (_name, target) => {
      const site = await serve((_request, response) => {
        response.writeHead(302, { location: target });
        response.end();
      });

      await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
        UnsafeUrlError,
      );
      expect(site.requests).toBe(1);
    },
  );

  it('gives up on a redirect loop', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(302, { location: '/again' });
      response.end();
    });

    await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
    expect(site.requests).toBe(4);
  });

  it('gives up on a redirect with nowhere to go', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(302);
      response.end();
    });

    await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
  });

  it('fails on an error answer without echoing the address', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(404);
      response.end('nope');
    });

    const failure = await fetcherFor()
      .fetch(`${site.origin}/secret-token-abc`, html)
      .catch((error: Error) => error);

    expect(failure).toBeInstanceOf(FetchFailedError);
    expect((failure as Error).message).not.toContain('secret-token-abc');
    expect((failure as Error).message).not.toContain('127.0.0.1');
  });

  it('refuses a content type it has no use for', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/zip' });
      response.end('PK');
    });

    await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
  });

  it('refuses a body that says up front it is too large', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('x'.repeat(5000));
    });

    await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
  });

  it('stops reading a body that grows past the limit without announcing it', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('x'.repeat(600));
      setTimeout(() => response.end('x'.repeat(600)), 20);
    });

    await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
  });

  it('keeps just the first part of a long page when asked to truncate', async () => {
    const site = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<head>${'x'.repeat(4000)}</head>`);
    });

    const page = await fetcherFor().fetch(`${site.origin}/`, {
      ...html,
      truncate: true,
    });

    expect(page.bytes).toHaveLength(1000);
    expect(page.bytes.toString().startsWith('<head>xxx')).toBe(true);
    expect(page.truncated).toBe(true);
  });

  it('counts a compressed body by what it expands to, so a gzip bomb is stopped', async () => {
    const bomb = gzipSync(Buffer.alloc(30 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(100 * 1024);
    const site = await serve((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
      });
      response.end(bomb);
    });

    await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
  });

  it('gives up on a site that never answers', async () => {
    jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.timeout(300));
    const site = await serve(() => undefined);

    await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
  });

  it('gives up on a site that stops halfway through the body', async () => {
    jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.timeout(300));
    const site = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<head>');
    });

    await expect(fetcherFor().fetch(`${site.origin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
  });

  it('reports a site that cannot be reached', async () => {
    const site = await serve(() => undefined);
    const closedOrigin = site.origin;
    await new Promise<void>((resolve) => site.server.close(() => resolve()));

    await expect(fetcherFor().fetch(`${closedOrigin}/`, html)).rejects.toThrow(
      FetchFailedError,
    );
  });

  describe('when a public-looking name resolves to an internal address', () => {
    const rebinding: FetchPolicy = {
      parseUrl: (raw) => new URL(raw),
      lookup: createSafeLookup(() =>
        Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
      ),
    };

    it('never connects, because the address is checked at connection time', async () => {
      const site = await serve((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('internal');
      });
      const port = new URL(site.origin).port;

      await expect(
        fetcherFor(rebinding).fetch(`http://rebind.example:${port}/`, html),
      ).rejects.toThrow(UnsafeUrlError);
      expect(site.requests).toBe(0);
    });

    it('also stops a redirect that lands on such a name', async () => {
      const port = { value: '' };
      const permissiveForRedirect: FetchPolicy = {
        parseUrl: (raw) => new URL(raw),
        lookup: createSafeLookup((hostname) =>
          Promise.resolve([
            {
              address:
                hostname === 'rebind.example' ? '127.0.0.1' : '93.184.216.34',
              family: 4,
            },
          ]),
        ),
      };
      const target = await serve(() => undefined);
      port.value = new URL(target.origin).port;
      const start = await serve((_request, response) => {
        response.writeHead(302, {
          location: `http://rebind.example:${port.value}/`,
        });
        response.end();
      });

      await expect(
        fetcherFor(permissiveForRedirect).fetch(`${start.origin}/`, html),
      ).rejects.toThrow(UnsafeUrlError);
      expect(target.requests).toBe(0);
    });
  });

  describe('with the real rules', () => {
    it.each([
      ['a loopback address', (origin: string) => origin],
      [
        'an internal name',
        (origin: string) => origin.replace('127.0.0.1', 'localhost'),
      ],
      [
        'the same address in decimal form',
        (origin: string) => origin.replace('127.0.0.1', '2130706433'),
      ],
    ])('never reaches %s', async (_name, rewrite) => {
      const site = await serve((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('internal');
      });

      await expect(
        fetcherFor(STRICT_FETCH_POLICY).fetch(`${rewrite(site.origin)}/`, html),
      ).rejects.toThrow(UnsafeUrlError);
      expect(site.requests).toBe(0);
    });
  });
});
