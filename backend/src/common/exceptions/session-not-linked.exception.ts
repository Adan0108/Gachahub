import { ForbiddenException } from '@nestjs/common';

/** Machine-readable code clients switch on; the message is for people. */
export const SESSION_NOT_LINKED = 'SESSION_NOT_LINKED';

/**
 * Thrown when a login has never been linked to a device (see
 * ChatDevicesService.linkSessionToDevice) but tries to do something only a
 * linked device may do, e.g. submit encrypted messages.
 */
export class SessionNotLinkedException extends ForbiddenException {
  constructor() {
    super({
      message: 'This login is not linked to a device',
      code: SESSION_NOT_LINKED,
    });
  }
}
