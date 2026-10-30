import { ConflictException } from '@nestjs/common';
import type { WithResponseExtras } from './response-extras';

/**
 * 409 for a Commit that lost the race for its epoch. Carries the winning handshake so the
 * client can restore, apply it and retry at once; only these two fields reach the response.
 */
export class MlsCommitConflictException
  extends ConflictException
  implements WithResponseExtras
{
  readonly outcome = 'conflict' as const;

  constructor(public readonly handshake: object) {
    super('Another commit already won this epoch');
  }

  responseExtras() {
    return { outcome: this.outcome, handshake: this.handshake };
  }
}
