import { ConflictException } from '@nestjs/common';

/**
 * 409 for a Commit that lost the race for its epoch. Carries the winning handshake so the
 * client can restore, apply it and retry at once; HttpExceptionFilter passes exactly these
 * two fields through its envelope, nothing else from the exception.
 */
export class MlsCommitConflictException extends ConflictException {
  readonly outcome = 'conflict' as const;

  constructor(public readonly handshake: object) {
    super('Another commit already won this epoch');
  }
}
