import { NotFoundException } from '@nestjs/common';

/** Machine-readable code clients switch on; the message is for people. */
export const DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND';

/**
 * Thrown when a request names a device the server has no record of. Carries a
 * code so a browser can tell "my identity is gone, start over" apart from an
 * ordinary 404 (a misrouted request, a proxy, a half-deployed backend).
 */
export class DeviceNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Device not found', code: DEVICE_NOT_FOUND });
  }
}
