import { ConflictException } from '@nestjs/common';

/** Machine-readable code clients switch on; the message is for people. */
export const DEVICE_REVOKED = 'DEVICE_REVOKED';

/**
 * Thrown when a request names a device that was revoked. A browser that gets it
 * must throw its identity away and start over with a new device, since a revoked
 * one can never be used again.
 */
export class DeviceRevokedException extends ConflictException {
  constructor() {
    super({
      message: 'This device has been revoked',
      code: DEVICE_REVOKED,
    });
  }
}
