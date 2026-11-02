import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EconomyService } from './economy.service';

/** Nightly upkeep: ranks drop as old Reputation leaves the 90-day window (no like or comment triggers that), old per-giver rows are cleared, and wallet caches are checked against the ledger. */
@Injectable()
export class EconomyRankJob {
  private readonly logger = new Logger(EconomyRankJob.name);

  constructor(private readonly economy: EconomyService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async refresh(): Promise<void> {
    try {
      const count = await this.economy.refreshStaleRanks();
      const pruned = await this.economy.pruneOldGiverDays();
      const mismatches = await this.economy.verifyWalletBalances();
      if (mismatches.length > 0) {
        this.logger.warn(
          `Detected ${mismatches.length} wallet-vs-ledger mismatch(es)`,
        );
      }
      this.logger.log(
        `Refreshed ${count} ranks, cleared ${pruned} old giver rows`,
      );
    } catch (error) {
      this.logger.warn(
        `Rank refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
