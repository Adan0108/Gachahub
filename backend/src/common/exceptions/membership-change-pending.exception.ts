import { ConflictException } from '@nestjs/common';

/** Machine-readable code clients switch on; the message is for people. */
export const MEMBERSHIP_CHANGE_PENDING = 'MEMBERSHIP_CHANGE_PENDING';

/**
 * Thrown when someone tries to send into an MLS group that still has a member
 * being removed. Until a Remove Commit lands the removed member's devices can
 * still read anything encrypted to the current epoch, so the next message must
 * wait for it. The sender's client finishes the removal first, then retries.
 */
export class MembershipChangePendingException extends ConflictException {
  constructor() {
    super({
      message: 'A member is being removed - finish that change before sending',
      code: MEMBERSHIP_CHANGE_PENDING,
    });
  }
}
