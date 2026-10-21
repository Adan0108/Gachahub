import type { Logger } from '@nestjs/common';

/** Broker startup must not gate HTTP startup. One attempt at a time, with
 * cancellable retries; clients retain their existing KafkaJS runtime behavior. */
export class KafkaBackgroundStart {
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private attempt?: Promise<void>;
  connected = false;

  constructor(
    private readonly connect: () => Promise<void>,
    private readonly disconnect: () => Promise<void>,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.stopped || this.connected || this.attempt) return;
    this.attempt = this.connect()
      .then(() => {
        this.connected = true;
      })
      .catch(async () => {
        this.connected = false;
        this.logger.warn('Kafka startup unavailable; retrying in background');
        await this.disconnect().catch(() => undefined);
        if (!this.stopped) {
          this.timer = setTimeout(() => this.start(), 2_000);
          this.timer.unref();
        }
      })
      .finally(() => {
        this.attempt = undefined;
      });
  }

  async waitForAttempt(): Promise<void> {
    await this.attempt;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.disconnect().catch(() => undefined);
    await this.attempt;
    // A connection completing during shutdown must not survive the service.
    await this.disconnect().catch(() => undefined);
    this.connected = false;
  }
}
