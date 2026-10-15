import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Agent, fetch as undiciFetch, type Response } from 'undici';
import { createSafeLookup, type SafeLookup } from './ssrf/safe-lookup';
import { parsePublicHttpUrl, UnsafeUrlError } from './ssrf/url-policy';

export const FETCH_POLICY = Symbol('LINK_PREVIEW_FETCH_POLICY');

/** What decides where the fetcher may go: which links are acceptable, and which addresses a name may resolve to. */
export interface FetchPolicy {
  parseUrl: (raw: string) => URL;
  lookup: SafeLookup;
}

export const STRICT_FETCH_POLICY: FetchPolicy = {
  parseUrl: parsePublicHttpUrl,
  lookup: createSafeLookup(),
};

/** The server could not get the page; the message never carries the address, which may hold a secret. */
export class FetchFailedError extends Error {}

export interface FetchRequest {
  accept: string;
  /** Most bytes to read for this content type, or null to refuse it. */
  limitFor: (contentType: string) => number | null;
  /** Keep what fits instead of failing when the body is longer than the limit. */
  truncate?: boolean;
}

export interface FetchedPage {
  /** Where the bytes actually came from, after any redirects. */
  url: URL;
  /** The media type alone, lower case, without parameters. */
  contentType: string;
  charset?: string;
  bytes: Buffer;
  /** True when the body was longer than the limit and only the start was kept. */
  truncated: boolean;
}

const MAX_REDIRECTS = 3;
const CONNECT_TIMEOUT_MS = 2_000;
const TOTAL_TIMEOUT_MS = 5_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The cause chain of a failed fetch, since undici wraps the real error. */
function causedByUnsafeUrl(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current && depth < 5;
    depth += 1
  ) {
    if (current instanceof UnsafeUrlError) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Fetches a page for a user without reaching our network: link and connect-time address checks, hand-followed redirects, time and size caps, no cookies. */
@Injectable()
export class SafeFetcher implements OnModuleDestroy {
  private readonly agent: Agent;

  constructor(@Inject(FETCH_POLICY) private readonly policy: FetchPolicy) {
    this.agent = new Agent({
      connect: { lookup: policy.lookup, timeout: CONNECT_TIMEOUT_MS },
      keepAliveTimeout: 1_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.agent.close();
  }

  async fetch(rawUrl: string, request: FetchRequest): Promise<FetchedPage> {
    const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
    let url = this.policy.parseUrl(rawUrl);

    for (let redirects = 0; ; redirects += 1) {
      const response = await this.get(url, request.accept, signal);

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (redirects >= MAX_REDIRECTS || !location) {
          throw new FetchFailedError('Redirect could not be followed');
        }
        url = this.policy.parseUrl(this.resolveLocation(location, url));
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new FetchFailedError(`The site answered ${response.status}`);
      }

      return this.read(url, response, request);
    }
  }

  private resolveLocation(location: string, from: URL): string {
    try {
      return new URL(location, from).href;
    } catch {
      throw new FetchFailedError('Redirect could not be followed');
    }
  }

  private async get(
    url: URL,
    accept: string,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await undiciFetch(url, {
        dispatcher: this.agent,
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': 'GachahubLinkPreview/1.0',
          accept,
          'accept-language': 'en',
        },
      });
    } catch (error) {
      if (causedByUnsafeUrl(error))
        throw new UnsafeUrlError('Non-public address');
      throw new FetchFailedError('The site could not be reached');
    }
  }

  private async read(
    url: URL,
    response: Response,
    request: FetchRequest,
  ): Promise<FetchedPage> {
    const header = response.headers.get('content-type') ?? '';
    const [type, ...parameters] = header.split(';');
    const contentType = type.trim().toLowerCase();
    const charset = parameters
      .map(
        (parameter) =>
          /^\s*charset\s*=\s*"?([^";\s]+)"?\s*$/i.exec(parameter)?.[1],
      )
      .find((value) => value !== undefined)
      ?.toLowerCase();

    const limit = request.limitFor(contentType);
    if (limit === null) {
      await response.body?.cancel();
      throw new FetchFailedError('Not something we can preview');
    }

    const declared = Number(response.headers.get('content-length'));
    if (!request.truncate && Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel();
      throw new FetchFailedError('Too large');
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
      const reader = response.body?.getReader();
      while (reader) {
        const { done, value } = (await reader.read()) as {
          done: boolean;
          value?: Uint8Array;
        };
        if (done || !value) break;

        total += value.byteLength;
        if (total > limit) {
          if (!request.truncate) throw new FetchFailedError('Too large');
          chunks.push(value.subarray(0, value.byteLength - (total - limit)));
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof FetchFailedError) throw error;
      throw new FetchFailedError('The site stopped answering');
    }

    return {
      url,
      contentType,
      charset,
      bytes: Buffer.concat(chunks),
      truncated,
    };
  }
}
