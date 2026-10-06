import {
  BadRequestException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { loadActiveUser } from '../common/guards/active-user.util';
import { PrismaService } from '../prisma/prisma.service';
import { LinkPreviewCache } from './link-preview.cache';
import {
  ConcurrencyGate,
  LinkPreviewRateLimiterService,
} from './link-preview-limits';
import { LinkPreviewResolver } from './link-preview.resolver';
import type { LinkPreview } from './link-preview.types';
import { parsePublicHttpUrl } from './ssrf/url-policy';

const MAX_FETCHES_AT_ONCE = 8;

const unavailable = () =>
  new UnprocessableEntityException('No preview is available for that link');

@Injectable()
export class LinkPreviewService {
  private readonly logger = new Logger(LinkPreviewService.name);
  private readonly gate = new ConcurrencyGate(MAX_FETCHES_AT_ONCE);
  /** Everyone asking about the same link while it is being fetched shares that one fetch. */
  private readonly inFlight = new Map<string, Promise<LinkPreview>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimiter: LinkPreviewRateLimiterService,
    private readonly cache: LinkPreviewCache,
    private readonly resolver: LinkPreviewResolver,
  ) {}

  /**
   * What to show for a link the sender is about to post. Every way of not getting a preview from
   * a well-formed public link gives the same answer, so this cannot be used to probe what the
   * server can reach.
   */
  async getPreview(userId: string, rawUrl: string): Promise<LinkPreview> {
    await loadActiveUser(this.prisma, userId);
    this.rateLimiter.assertNotRateLimited(userId);

    const url = this.parse(rawUrl);
    const key = url.href;

    const cached = await this.cache.get(key);
    if (cached) {
      if (cached.ok) return cached.preview;
      throw unavailable();
    }

    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.load(url).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }

  private parse(rawUrl: string): URL {
    try {
      return parsePublicHttpUrl(rawUrl);
    } catch {
      throw new BadRequestException('That is not a link that can be previewed');
    }
  }

  private load(url: URL): Promise<LinkPreview> {
    return this.gate.run(async () => {
      try {
        const preview = await this.resolver.resolve(url);
        await this.cache.setPreview(url.href, preview);
        return preview;
      } catch (error) {
        // The host only: the rest of a link can carry a secret.
        this.logger.warn(
          `No preview for ${url.hostname}: ${error instanceof Error ? error.constructor.name : 'unknown'}`,
        );
        await this.cache.setFailure(url.href);
        throw unavailable();
      }
    });
  }
}
