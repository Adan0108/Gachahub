import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  parseModerationPolicyOutput,
  parsePersistedPolicyInput,
} from './moderation-policy.contract';
import {
  POLICY_POLL_MS,
  POLICY_RECONCILE_MS,
  POLICY_WORK_BATCH_SIZE,
} from './moderation-policy-execution.constants';
import { ModerationPolicyRepository } from './moderation-policy.repository';
import {
  ModerationPolicyService,
  UnsupportedModerationPolicyEvidenceError,
} from './moderation-policy.service';
import type {
  ModerationPolicyInput,
  ModerationPolicyOutput,
} from './moderation-policy.types';

export function persistedPolicyInput(
  classifierProfile: string,
  result: unknown,
): ModerationPolicyInput {
  try {
    return parsePersistedPolicyInput(classifierProfile, result);
  } catch {
    throw new UnsupportedModerationPolicyEvidenceError();
  }
}

@Injectable()
export class ModerationPolicyRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModerationPolicyRunner.name);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private active?: Promise<void>;
  private reconcileAfterId?: string;
  private nextReconcileAt = 0;

  constructor(
    private readonly repository: ModerationPolicyRepository,
    private readonly policy: ModerationPolicyService,
  ) {}

  onModuleInit(): void {
    this.startCycle();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }

  private startCycle(): void {
    if (this.stopped || this.active) return;
    this.active = this.cycle()
      .catch(() => {
        // Never log Prisma arguments, classifier payloads or exception messages.
        this.logger.warn(
          'Moderation policy cycle failed; durable work will retry',
        );
      })
      .finally(() => {
        this.active = undefined;
        if (!this.stopped)
          this.timer = setTimeout(() => this.startCycle(), POLICY_POLL_MS);
      });
  }

  private async cycle(): Promise<void> {
    if (Date.now() >= this.nextReconcileAt) {
      this.reconcileAfterId = await this.repository.reconcile(
        this.reconcileAfterId,
      );
      this.nextReconcileAt = Date.now() + POLICY_RECONCILE_MS;
    }
    for (
      let index = 0;
      index < POLICY_WORK_BATCH_SIZE && !this.stopped;
      index++
    ) {
      if (!(await this.processNext())) break;
    }
  }

  async processNext(): Promise<boolean> {
    const claim = await this.repository.claimNext();
    if (!claim) return false;
    // Database failures escape: retain the lease for crash recovery, never lose the source result.
    const analysis = await this.repository.loadAnalysis(claim.analysisId);
    let output: ModerationPolicyOutput;
    try {
      if (!analysis || analysis.status !== 'SUCCEEDED')
        throw new UnsupportedModerationPolicyEvidenceError();
      output = parseModerationPolicyOutput(
        this.policy.evaluate(
          persistedPolicyInput(analysis.classifierProfile, analysis.result),
        ),
      );
    } catch (error) {
      if (error instanceof UnsupportedModerationPolicyEvidenceError)
        await this.repository.unsupported(claim);
      else await this.repository.retry(claim);
      return true;
    }
    await this.repository.succeed(claim, output);
    return true;
  }
}
