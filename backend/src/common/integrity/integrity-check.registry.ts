import { Injectable } from '@nestjs/common';
import type { IntegrityCheck } from './integrity-check';

/** Where each domain registers its invariants (usually in onModuleInit), so the sweeper stays domain-blind. */
@Injectable()
export class IntegrityCheckRegistry {
  private readonly checks: IntegrityCheck[] = [];

  register(...checks: IntegrityCheck[]): void {
    this.checks.push(...checks);
  }

  list(): readonly IntegrityCheck[] {
    return this.checks;
  }
}
