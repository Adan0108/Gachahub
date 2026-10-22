import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';
import { KafkaBackgroundStart } from '../kafka/kafka-background-start';
import { KAFKA_TOPICS } from '../kafka/kafka-topics';
import { parseModerationResultEvent } from './moderation-result.contract';
import { ModerationResultService } from './moderation-result.service';

@Injectable()
export class ModerationResultConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModerationResultConsumer.name);
  private readonly consumer: Consumer;
  private readonly startup: KafkaBackgroundStart;

  constructor(private readonly results: ModerationResultService) {
    const brokers = process.env.KAFKA_BROKERS?.split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    if (!brokers?.length) throw new Error('KAFKA_BROKERS is missing');
    this.consumer = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID ?? 'gachahub-backend',
      brokers,
    }).consumer({
      groupId:
        process.env.KAFKA_MODERATION_RESULTS_GROUP_ID ??
        'gachahub-moderation-results',
    });
    this.startup = new KafkaBackgroundStart(
      async () => {
        await this.consumer.connect();
        await this.consumer.subscribe({
          topics: [KAFKA_TOPICS.MODERATION_RESULTS],
        });
        await this.consumer.run({
          eachMessage: (payload) => this.handleMessage(payload),
        });
      },
      () => this.consumer.disconnect(),
      this.logger,
    );
  }

  onModuleInit(): void {
    this.startup.start();
  }
  async onModuleDestroy(): Promise<void> {
    await this.startup.stop();
  }

  async handleMessage({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;
    let event: ReturnType<typeof parseModerationResultEvent>;
    try {
      // Check bytes before decoding/parsing. Never log payloads or parser errors.
      if (message.value.length > 32 * 1024) throw new Error('Oversized event');
      event = parseModerationResultEvent(message.value.toString('utf8'));
    } catch {
      this.logger.warn('Skipping invalid moderation result');
      return;
    }
    // KafkaJS logs thrown stacks. Prisma errors can embed query arguments, so
    // escape with a fixed retryable error rather than exposing result values.
    try {
      await this.results.ingest(event);
    } catch {
      throw new Error('Moderation result persistence failed');
    }
  }
}
