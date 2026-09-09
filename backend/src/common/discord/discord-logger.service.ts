import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_FIELD_VALUE_LIMIT = 1024;
const STACK_FRAME_LIMIT = 5;
const DEDUP_WINDOW_MS = 60_000;
const BANNER_FILENAME = 'banner-500.png';
const BANNER_PATH = join(process.cwd(), 'assets', 'discord', BANNER_FILENAME);

export type DiscordLogField = { name: string; value: string; inline?: boolean };

export type DiscordLogReport = {
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
  private readonly banner = loadBanner(this.logger);

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

    const embed = {
      title: truncate(`🔴 ${report.title}`, DISCORD_EMBED_TITLE_LIMIT),
      color: 0xff0000,
      fields,
      image: this.banner ? { url: `attachment://${BANNER_FILENAME}` } : undefined,
      timestamp: new Date().toISOString(),
      footer: { text: 'GachaHub API' },
    };

    const body = new FormData();
    body.append('payload_json', JSON.stringify({ embeds: [embed] }));
    if (this.banner) {
      body.append('files[0]', new Blob([new Uint8Array(this.banner)]), BANNER_FILENAME);
    }

    try {
      await fetch(this.webhookUrl, { method: 'POST', body });
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

function loadBanner(logger: Logger): Buffer | undefined {
  try {
    return readFileSync(BANNER_PATH);
  } catch {
    logger.warn(`Discord banner image not found at ${BANNER_PATH}, sending embeds without it`);
    return undefined;
  }
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
