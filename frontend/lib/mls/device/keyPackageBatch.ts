import { bytesToBase64 } from '../storage/base64';
import type { DeviceIdentityStore } from '../contract/client';

export const SINGLE_USE_BATCH_SIZE = 10;

export interface KeyPackageUpload {
  kind: 'LAST_RESORT' | 'SINGLE_USE';
  payload: string;
}

/** Generates key packages in the shape the backend accepts, last-resort first: shared by registration and top-ups. */
export async function generateKeyPackageUploads(
  store: Pick<DeviceIdentityStore, 'generateKeyPackages'>,
  options: { singleUse: number; lastResort: boolean },
): Promise<KeyPackageUpload[]> {
  const uploads: KeyPackageUpload[] = [];

  if (options.lastResort) {
    const [lastResort] = await store.generateKeyPackages(1, 'LAST_RESORT');
    if (!lastResort) throw new Error('generateKeyPackages returned no key packages');
    uploads.push({ kind: 'LAST_RESORT', payload: bytesToBase64(lastResort) });
  }
  if (options.singleUse > 0) {
    const packages = await store.generateKeyPackages(options.singleUse, 'SINGLE_USE');
    for (const keyPackage of packages) {
      uploads.push({ kind: 'SINGLE_USE', payload: bytesToBase64(keyPackage) });
    }
  }
  return uploads;
}
