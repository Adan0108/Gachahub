import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_FIELD_VALUE_LIMIT = 1024;
const STACK_FRAME_LIMIT = 5;
const DEDUP_WINDOW_MS = 60_000;

export type DiscordLogSource = 'http' | 'cron' | 'socket';

const BANNER_FILENAMES: Record<DiscordLogSource, string> = {
  http: 'banner-500.png',
  cron: 'banner-cron.png',
  socket: 'banner-socket.png',
};

export type DiscordLogField = { name: string; value: string; inline?: boolean };

export type DiscordLogReport = {
  source: DiscordLogSource;
  title: string;
  errorName: string;
  fields: DiscordLogField[];
  stack?: string;
  // Defaults to `${errorName} ${title}`. Pass one explicitly when a source needs
  // a different notion of "same error" (e.g. one that ignores per-request IDs).
  dedupKey?: string;
};

@Injectable()
export class DiscordLoggerService {
  private readonly logger = new Logger(DiscordLoggerService.name);
  private readonly webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  private readonly recentlySent = new Map<string, number>();
  private readonly banners = loadBanners(this.logger);

  async sendError(report: DiscordLogReport) {
    if (!this.webhookUrl) return;

    const signature = report.dedupKey ?? `${report.errorName} ${report.title}`;
    if (!this.shouldSend(signature)) return;

    const fields = report.fields.map((field) => ({
      ...field,
      value: truncate(field.value, DISCORD_EMBED_FIELD_VALUE_LIMIT),
    }));

    if (report.stack !== undefined) {
      fields.push({
        name: 'Stack',
        value: '```\n' + filterStack(report.stack) + '\n```',
        inline: false,
      });
    }

    const bannerFilename = BANNER_FILENAMES[report.source];
    const banner = this.banners.get(report.source);

    const embed = {
      title: truncate(`🔴 ${report.title}`, DISCORD_EMBED_TITLE_LIMIT),
      color: 0xff0000,
      fields,
      image: banner ? { url: `attachment://${bannerFilename}` } : undefined,
      timestamp: new Date().toISOString(),
      footer: { text: 'GachaHub API' },
    };

    const body = new FormData();
    body.append('payload_json', JSON.stringify({ embeds: [embed] }));
    if (banner) {
      body.append('files[0]', new Blob([new Uint8Array(banner)]), bannerFilename);
    }

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5_000),
      });

      if (!res.ok) {
        this.logger.warn(`Discord webhook rejected the log: ${res.status}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to send Discord log: ${err}`);
    }
  }

  /**
  * Skips a send if the same signature fired within the dedup window,
  * so a flapping dependency doesn't spam the channel or hit Discord's rate limit.
  */
  private shouldSend(signature: string): boolean {
    const now = Date.now();
    for (const [key, sentAt] of this.recentlySent) {
      if (now - sentAt > DEDUP_WINDOW_MS) this.recentlySent.delete(key);
    }

    if (this.recentlySent.has(signature)) return false;

    this.recentlySent.set(signature, now);
    return true;
  }
}

function loadBanners(logger: Logger): Map<DiscordLogSource, Buffer> {
  const banners = new Map<DiscordLogSource, Buffer>();

  for (const [source, filename] of Object.entries(BANNER_FILENAMES) as [DiscordLogSource, string][]) {
    const path = join(process.cwd(), 'assets', 'discord', filename);
    try {
      banners.set(source, readFileSync(path));
    } catch {
      logger.warn(`Discord banner image not found at ${path}, sending "${source}" embeds without it`);
    }
  }

  return banners;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function filterStack(stack?: string): string {
  if (!stack) return 'No stack trace available';

  const frames = stack.split('\n').slice(1);
  const appFrames = frames.filter((line) => /[\\/]src[\\/]/.test(line));
  const relevant = (appFrames.length > 0 ? appFrames : frames).slice(0, STACK_FRAME_LIMIT);

  return truncate(relevant.join('\n').trim() || 'No stack trace available', DISCORD_EMBED_FIELD_VALUE_LIMIT - 8);
}
