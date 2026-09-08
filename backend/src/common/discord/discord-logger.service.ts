import { Injectable, Logger } from '@nestjs/common';

const DISCORD_EMBED_TITLE_LIMIT = 256;

@Injectable()
export class DiscordLoggerService {
  private readonly logger = new Logger(DiscordLoggerService.name);
  private readonly webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  async sendError(message: string, context?: Record<string, unknown>) {
    if (!this.webhookUrl) return;

    const title =
      message.length > DISCORD_EMBED_TITLE_LIMIT
        ? message.slice(0, DISCORD_EMBED_TITLE_LIMIT - 1) + '…'
        : message;

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title,
              color: 0xff0000,
              description: context
                ? '```json\n' + JSON.stringify(context, null, 2) + '\n```'
                : undefined,
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      });
    } catch (err) {
      this.logger.warn(`Failed to send Discord log: ${err}`);
    }
  }
}
