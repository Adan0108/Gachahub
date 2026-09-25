import {
  deleteRecord,
  encryptAndStore,
  loadAndDecryptOrMissing,
  openMlsDatabase,
} from '../storage/mlsEncryptedStore';
import type { PeerKey, PeerVerification } from './verificationState';

export interface VerifiedPeerStore {
  get(key: PeerKey): Promise<PeerVerification | undefined>;
  save(record: PeerVerification): Promise<void>;
  remove(key: PeerKey): Promise<void>;
}

// Keyed per account and peer so logins never share verification but conversations do
const recordId = ({ ownUserId, peerUserId }: PeerKey) => JSON.stringify(['peer', ownUserId, peerUserId]);

export class InMemoryVerifiedPeerStore implements VerifiedPeerStore {
  private readonly values = new Map<string, PeerVerification>();

  async get(key: PeerKey): Promise<PeerVerification | undefined> {
    return this.values.get(recordId(key));
  }

  async save(record: PeerVerification): Promise<void> {
    this.values.set(recordId(record), record);
  }

  async remove(key: PeerKey): Promise<void> {
    this.values.delete(recordId(key));
  }
}

const VERIFIED_PEER_STORE = 'verifiedPeers';

export class EncryptedIndexedDbVerifiedPeerStore implements VerifiedPeerStore {
  async get(key: PeerKey): Promise<PeerVerification | undefined> {
    const db = await openMlsDatabase();
    return loadAndDecryptOrMissing<PeerVerification>(db, VERIFIED_PEER_STORE, recordId(key));
  }

  async save(record: PeerVerification): Promise<void> {
    const db = await openMlsDatabase();
    await encryptAndStore(db, VERIFIED_PEER_STORE, recordId(record), record);
  }

  async remove(key: PeerKey): Promise<void> {
    const db = await openMlsDatabase();
    await deleteRecord(db, VERIFIED_PEER_STORE, recordId(key));
  }
}
