import type { DeviceId } from '../contract/types';

/** What the sender's device writes into a message's `encryptionMeta`, so other devices know where it came from. */
export function senderMeta(deviceId: DeviceId): { senderDeviceId: DeviceId } {
  return { senderDeviceId: deviceId };
}

/**
 * Whether `deviceId` itself sent the message. MLS deletes the key a message was encrypted
 * with as soon as it is sent, so the sending device can never decrypt it again and has to
 * rely on the copy it saved at send time. Every OTHER device of the same user can decrypt
 * it like any other member's message, which is how a message shows up on all of your devices.
 */
export function wasSentByDevice(encryptionMeta: unknown, deviceId: DeviceId): boolean {
  return (
    typeof encryptionMeta === 'object' &&
    encryptionMeta !== null &&
    (encryptionMeta as { senderDeviceId?: unknown }).senderDeviceId === deviceId
  );
}
