import { base64ToBytes } from '../storage/base64';
import type { DeviceId, KeyPackageOffer, UserId } from '../contract/types';

/** One entry of the backend's key-package claim response: a device and one of its key packages. */
export interface ClaimedKeyPackage {
  deviceId: DeviceId;
  signaturePublicKey: string;
  payload: string;
}

export function toKeyPackageOffer(userId: UserId, claimed: ClaimedKeyPackage): KeyPackageOffer {
  return {
    credential: {
      userId,
      deviceId: claimed.deviceId,
      signatureKey: base64ToBytes(claimed.signaturePublicKey),
    },
    keyPackage: base64ToBytes(claimed.payload),
  };
}
