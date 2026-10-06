import { Module } from '@nestjs/common';
import { LinkPreviewCache } from './link-preview.cache';
import { LinkPreviewRateLimiterService } from './link-preview-limits';
import { LinkPreviewResolver } from './link-preview.resolver';
import { LinkPreviewService } from './link-preview.service';
import { LinkPreviewsController } from './link-previews.controller';
import { FETCH_POLICY, SafeFetcher, STRICT_FETCH_POLICY } from './safe-fetcher';

@Module({
  controllers: [LinkPreviewsController],
  providers: [
    LinkPreviewService,
    LinkPreviewResolver,
    LinkPreviewCache,
    LinkPreviewRateLimiterService,
    SafeFetcher,
    { provide: FETCH_POLICY, useValue: STRICT_FETCH_POLICY },
  ],
})
export class LinkPreviewsModule {}
