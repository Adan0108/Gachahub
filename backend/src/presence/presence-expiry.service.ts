import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EXPIRY_SWEEP_MS } from './presence.constants';
import { PresenceService } from './presence.service';

/** Brings people back online when the time they chose to be invisible for runs out. */
@Injectable()
export class PresenceExpiryService {
  private readonly logger = new Logger(PresenceExpiryService.name);

  constructor(private readonly presence: PresenceService) {}

  @Interval(EXPIRY_SWEEP_MS)
  async sweep(): Promise<void> {
    try {
      await this.presence.expireDue();
    } catch (error) {
      this.logger.warn(`Presence sweep failed: ${(error as Error).message}`);
    }
  }
}
