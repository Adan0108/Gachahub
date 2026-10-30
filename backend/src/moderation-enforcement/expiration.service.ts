import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EnforcementService } from './enforcement.service';

@Injectable()
export class SanctionExpirationService {
  private readonly logger = new Logger(SanctionExpirationService.name);
  private running = false;
  constructor(
    private readonly db: PrismaService,
    private readonly enforcement: EnforcementService,
  ) {}
  @Interval(60000)
  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.db.$transaction(async (tx) => {
        const due = await tx.$queryRaw<
          Array<{ id: string; subjectId: string }>
        >`SELECT id, "subjectId" FROM moderation_sanctions WHERE status='ACTIVE' AND "expiresAt" <= now() ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED`;
        for (const row of due) {
          await tx.moderationSanction.update({
            where: { id: row.id },
            data: { status: 'EXPIRED' },
          });
          await this.enforcement.audit(
            tx,
            null,
            'SANCTION_EXPIRED',
            row.id,
            'The scheduled restriction ended',
            { status: 'ACTIVE' },
            { status: 'EXPIRED' },
          );
          await this.enforcement.notice(tx, row.subjectId, null, row.id);
        }
        return due.length;
      });
      if (count)
        this.logger.log(
          JSON.stringify({ event: 'moderation.sanctions.expired', count }),
        );
    } catch {
      this.logger.error(
        JSON.stringify({ event: 'moderation.sanctions.reconciliation_failed' }),
      );
    } finally {
      this.running = false;
    }
  }
}
