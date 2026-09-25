import { Injectable } from '@nestjs/common';
import type { IntegrityCheck } from './integrity-check';

/** Where each domain registers its invariants (usually in onModuleInit), so the sweeper stays domain-blind. */
@Injectable()
export class IntegrityCheckRegistry {
  private readonly checksByName = new Map<string, IntegrityCheck>();

  /** Throws on a name already registered - two checks silently sharing a name would double every alert. */
  register(...checks: IntegrityCheck[]): void {
    for (const check of checks) {
      if (this.checksByName.has(check.name)) {
        throw new Error(
          `Integrity check "${check.name}" is already registered`,
        );
      }
      this.checksByName.set(check.name, check);
    }
  }

  list(): readonly IntegrityCheck[] {
    return [...this.checksByName.values()];
  }
}
