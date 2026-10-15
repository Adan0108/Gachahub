
export type DeviceId = string;
export type UserId = string;
export type ConversationId = string;

/** MLS epoch number for one conversation */
export type Epoch = number;

/** Asserts "this device belongs to this user." Every Add, Welcome, and Commit carries one */
export interface DeviceCredential {
  userId: UserId;
  deviceId: DeviceId;
  /** Raw MLS signature public key bytes for this device. */
  signatureKey: Uint8Array;
}

/** The decrypted, application-level content of one MLS application message */
export interface BodyEnvelope {
  v: 1;
  type: 'text' | 'delete' | 'reaction';
  body: unknown;
  /** Link preview cards for a text message; only ever read through readLinkPreviews, since the sender is a peer. */
  previews?: LinkPreviewRef[];
}

/** A new body for an earlier text message by the same author; `n` is which edit of that message this is (1 for the first). */
export interface EditEnvelope {
  v: 1;
  type: 'edit';
  body: { targetMessageId: string; text: string; n: number };
}

/** An encrypted blob uploaded as opaque bytes; `blob` is its upload id, the rest decrypts it. */
export interface EncryptedBlobRef {
  blob: string;
  /** base64 AES-256 key. */
  key: string;
  /** base64 96-bit GCM IV. */
  iv: string;
  /** base64 SHA-256 of the plaintext. */
  sha256: string;
}

export interface AttachmentThumb extends EncryptedBlobRef {
  width: number;
  height: number;
}

/** What a link preview card shows. It travels inside the encrypted message, so recipients never contact the linked site. */
export interface LinkPreviewRef {
  /** The link the card is for; it must appear in the message text. */
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  thumb?: AttachmentThumb;
}

export interface AttachmentFile extends EncryptedBlobRef {
  name: string;
  mime: string;
  size: number;
  thumb?: AttachmentThumb;
}

export interface AttachmentEnvelope {
  v: 1;
  type: 'attachment';
  body?: string;
  files: AttachmentFile[];
}

export type PlaintextEnvelope = BodyEnvelope | EditEnvelope | AttachmentEnvelope;

export type RejectReason =
  | 'credential-mismatch'
  | 'wrong-conversation'
  | 'wrong-device'
  | 'stale-epoch'
  | 'malformed';

export interface KeyPackageOffer {
  credential: DeviceCredential;
  keyPackage: Uint8Array;
}

/** Which device, without its key - enough to find its leaf in the group. */
export type DeviceIdentity = Pick<DeviceCredential, 'userId' | 'deviceId'>;

/** What the caller supplies to GroupSession.stageCommit */
export interface MembershipChangeRequest {
  added: KeyPackageOffer[];
  removed: DeviceIdentity[];
}

/** What ProcessResult's 'commit' case reports back: who actually joined or left, as identities only - the receiver doesn't need the joiner's raw key package bytes after the fact, just who they are */
export interface MembershipChange {
  added: DeviceCredential[];
  removed: DeviceCredential[];
}

/** Result of processing exactly one incoming wire item */
export type ProcessResult =
  | {
      kind: 'application';
      senderDeviceId: DeviceId;
      epoch: Epoch;
      envelope: PlaintextEnvelope;
    }
  | {
      kind: 'commit';
      epoch: Epoch;
      membershipChange: MembershipChange | null;
    }
  | {
      kind: 'proposal';
      epoch: Epoch;
      proposalType: 'add' | 'remove';
      proposer: DeviceCredential;
      /** True when this proposal arrived through the server's external_senders mechanism rather than from a group member */
      isExternal: boolean;
    }
  | {
      kind: 'rejected';
      reason: RejectReason;
    };
