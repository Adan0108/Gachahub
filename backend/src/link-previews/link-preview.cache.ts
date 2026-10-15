import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { LinkPreview } from './link-preview.types';

const PREVIEW_TTL_SECONDS = 6 * 60 * 60;
const FAILURE_TTL_SECONDS = 10 * 60;

export type CachedPreview = { ok: true; preview: LinkPreview } | { ok: false };

/** Recent previews (6 h, failures 10 min) keyed by a hash of the link; a Redis problem just means no caching. */
@Injectable()
export class LinkPreviewCache {
  private readonly logger = new Logger(LinkPreviewCache.name);

  constructor(private readonly redis: RedisService) {}

  async get(url: string): Promise<CachedPreview | null> {
    try {
      const raw = await this.redis.get(this.key(url));
      if (raw === null) return null;

      const cached = JSON.parse(raw) as CachedPreview;
      return typeof cached === 'object' &&
        cached !== null &&
        typeof cached.ok === 'boolean'
        ? cached
        : null;
    } catch (error) {
      this.logger.warn('Could not read the link preview cache', error);
      return null;
    }
  }

  setPreview(url: string, preview: LinkPreview): Promise<void> {
    return this.set(url, { ok: true, preview }, PREVIEW_TTL_SECONDS);
  }

  setFailure(url: string): Promise<void> {
    return this.set(url, { ok: false }, FAILURE_TTL_SECONDS);
  }

  private async set(
    url: string,
    value: CachedPreview,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(this.key(url), JSON.stringify(value), ttlSeconds);
    } catch (error) {
      this.logger.warn('Could not write the link preview cache', error);
    }
  }

  private key(url: string): string {
    return `link-preview:v1:${createHash('sha256').update(url).digest('hex')}`;
  }
}
