import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EconomyService } from './economy.service';

/** Ranks drop as old Reputation leaves the 90-day window, which no like or comment triggers; this catches them up nightly. */
@Injectable()
export class EconomyRankJob {
  private readonly logger = new Logger(EconomyRankJob.name);

  constructor(private readonly economy: EconomyService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async refresh(): Promise<void> {
    try {
      const count = await this.economy.refreshStaleRanks();
      this.logger.log(`Refreshed ${count} ranks`);
    } catch (error) {
      this.logger.warn(
        `Rank refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
