import {
  defaultCapabilities,
  encodeMlsMessage,
  generateKeyPackageWithKey,
  type Credential,
  type KeyPackage,
  type PrivateKeyPackage,
} from 'ts-mls';
import type { DeviceIdentityStore } from '../contract/client';
import type { DeviceCredential, DeviceId, UserId } from '../contract/types';
import {
  InMemoryDeviceIdentityStorage,
  type DeviceIdentityStorage,
  type StoredKeyPackage,
} from '../storage/deviceIdentityStorage';
import { encodeIdentity } from './identityCodec';
import { getImpl } from './tsMlsShared';

// Prefixed before signing a session-link challenge, so the device key never signs raw server bytes that could double as an MLS structure
export const SESSION_LINK_LABEL = 'gachahub/session-link/v1\n';
const SESSION_LINK_CHALLENGE_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// ts-mls's own defaultLifetime is notBefore=0/notAfter=max-int64 - an effectively-infinite key package a real server should never accept
const KEY_PACKAGE_LIFETIME_DAYS = 90;

function boundedLifetime() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    notBefore: now,
    notAfter: now + BigInt(KEY_PACKAGE_LIFETIME_DAYS * 24 * 60 * 60),
  };
}

export class TsMlsDeviceIdentityStore implements DeviceIdentityStore {
  private deviceId: DeviceId | undefined;
  private credential: DeviceCredential | undefined;
  // One persistent identity signing keypair, reused for every key package this device ever creates. generateKeyPackage() (no "WithKey") mints a FRESH signature key on every call - using it directly would mean each key package for the same device reports a different signaturePublicKey, making device identity meaningless for pinning/safety-number checks
  private signatureKeyPair: { signKey: Uint8Array; publicKey: Uint8Array } | undefined;
  private nextKeyPackageId = 0;
  readonly keyPackagesById = new Map<string, StoredKeyPackage>();
  private hydrationPromise: Promise<void> | undefined;

  constructor(
    private readonly storage: DeviceIdentityStorage = new InMemoryDeviceIdentityStorage(),
  ) {}

  async isProvisioned(): Promise<boolean> {
    await this.ensureHydrated();
    return this.credential !== undefined;
  }

  async provision(userId: UserId): Promise<DeviceCredential> {
    this.hydrationPromise = Promise.resolve();

    const impl = await getImpl();
    this.deviceId = crypto.randomUUID();
    this.signatureKeyPair = await impl.signature.keygen();
    const mlsCredential: Credential = {
      credentialType: 'basic',
      identity: encodeIdentity(userId, this.deviceId),
    };
    const kp = await generateKeyPackageWithKey(
      mlsCredential,
      defaultCapabilities(),
      boundedLifetime(),
      [],
      this.signatureKeyPair,
      impl,
    );
    // Never uploaded, never offered to anyone - this device's own package for founding groups it creates itself (TsMlsGroupSessionFactory. create/pickOwnKeyPackage)
    this.storeKeyPackage(kp.publicPackage, kp.privatePackage, 'FOUNDER');
    this.credential = {
      userId,
      deviceId: this.deviceId,
      signatureKey: this.signatureKeyPair.publicKey,
    };
    await this.persist();
    return this.credential;
  }

  async signSessionLinkChallenge(challenge: string): Promise<Uint8Array> {
    if (!SESSION_LINK_CHALLENGE_SHAPE.test(challenge)) {
      throw new Error('Unexpected challenge format');
    }
    await this.ensureHydrated();
    if (!this.signatureKeyPair) {
      throw new Error('Device not provisioned yet');
    }
    const message = new TextEncoder().encode(SESSION_LINK_LABEL + challenge);
    return (await getImpl()).signature.sign(this.signatureKeyPair.signKey, message);
  }

  async getOwnCredential(): Promise<DeviceCredential> {
    await this.ensureHydrated();
    if (!this.credential) {
      throw new Error('Device not provisioned yet');
    }
    return this.credential;
  }

  /** A fresh key package that is never uploaded or stored: for a join this device makes by itself. */
  async createEphemeralKeyPackage(): Promise<{
    publicPackage: KeyPackage;
    privatePackage: PrivateKeyPackage;
  }> {
    await this.ensureHydrated();
    return this.buildKeyPackage();
  }

  private async buildKeyPackage() {
    if (!this.credential || !this.signatureKeyPair || !this.deviceId) {
      throw new Error('Device not provisioned yet');
    }
    const mlsCredential: Credential = {
      credentialType: 'basic',
      identity: encodeIdentity(this.credential.userId, this.deviceId),
    };
    return generateKeyPackageWithKey(
      mlsCredential,
      defaultCapabilities(),
      boundedLifetime(),
      [],
      this.signatureKeyPair,
      await getImpl(),
    );
  }

  /** Returns raw base64-free encodeMlsMessage(mls_key_package) bytes - no adapter-specific wrapping */
  async generateKeyPackages(
    count: number,
    kind: 'SINGLE_USE' | 'LAST_RESORT' = 'SINGLE_USE',
  ): Promise<Uint8Array[]> {
    await this.ensureHydrated();
    if (!this.credential || !this.signatureKeyPair || !this.deviceId) {
      throw new Error('Device not provisioned yet');
    }
    const out: Uint8Array[] = [];
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- each key package's keygen depends on none of the others, but ts-mls's API is one-at-a-time
      const kp = await this.buildKeyPackage();
      this.storeKeyPackage(kp.publicPackage, kp.privatePackage, kind);
      out.push(
        encodeMlsMessage({
          keyPackage: kp.publicPackage,
          wireformat: 'mls_key_package',
          version: 'mls10',
        }),
      );
    }
    await this.persist();
    return out;
  }

  /** Removes a used SINGLE_USE key package's private key from local storage - its one-time secret has already been spent by the join it was matched to, so keeping it around only extends how long that key material sits on disk for no benefit, and lets a replayed/duplicated Welcome for a different conversation be satisfied by it again */
  async consumeKeyPackage(id: string): Promise<void> {
    const stored = this.keyPackagesById.get(id);
    if (!stored || stored.kind !== 'SINGLE_USE') {
      return;
    }
    this.keyPackagesById.delete(id);
    await this.persist();
  }

  async revoke(): Promise<void> {
    this.hydrationPromise = Promise.resolve();
    this.deviceId = undefined;
    this.credential = undefined;
    this.signatureKeyPair = undefined;
    this.nextKeyPackageId = 0;
    this.keyPackagesById.clear();
    await this.storage.clear();
  }

  private ensureHydrated(): Promise<void> {
    if (!this.hydrationPromise) {
      this.hydrationPromise = this.hydrate().catch((error: unknown) => {
        // Let a real storage failure be retried on the next call instead of permanently wedging this store on one bad attempt
        this.hydrationPromise = undefined;
        throw error;
      });
    }
    return this.hydrationPromise;
  }

  private async hydrate(): Promise<void> {
    const persisted = await this.storage.load();
    if (!persisted) {
      return;
    }
    this.deviceId = persisted.deviceId;
    this.credential = persisted.credential;
    this.signatureKeyPair = persisted.signatureKeyPair;
    this.nextKeyPackageId = persisted.nextKeyPackageId;
    this.keyPackagesById.clear();
    for (const keyPackage of persisted.keyPackages) {
      this.keyPackagesById.set(keyPackage.id, keyPackage);
    }
  }

  private async persist(): Promise<void> {
    if (!this.credential || !this.deviceId || !this.signatureKeyPair) {
      return;
    }
    await this.storage.save({
      deviceId: this.deviceId,
      credential: this.credential,
      signatureKeyPair: this.signatureKeyPair,
      nextKeyPackageId: this.nextKeyPackageId,
      keyPackages: [...this.keyPackagesById.values()],
    });
  }

  private storeKeyPackage(
    publicPackage: KeyPackage,
    privatePackage: PrivateKeyPackage,
    kind: StoredKeyPackage['kind'],
  ): string {
    const id = `kp-${this.nextKeyPackageId}`;
    this.nextKeyPackageId += 1;
    this.keyPackagesById.set(id, { id, kind, publicPackage, privatePackage });
    return id;
  }
}
