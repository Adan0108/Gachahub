import {
  createGroup,
  decodeMlsMessage,
  decodeGroupState,
  encodeMlsMessage,
  joinGroup,
  joinGroupExternal,
  emptyPskIndex,
  type CiphersuiteImpl,
  type ClientState,
} from 'ts-mls';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { makeKeyPackageRef } from 'ts-mls/keyPackage.js';
import type { GroupSession, GroupSessionFactory } from '../contract/client';
import type { ConversationId } from '../contract/types';
import {
  CredentialMismatchError,
  MembershipMismatchError,
  StaleWelcomeError,
} from '../contract/errors';
import { bytesEqual } from '../bytes';
import type { TsMlsDeviceIdentityStore } from './tsMlsDeviceIdentityStore';
import { encodeGroupInfoFor, TsMlsGroupSession } from './tsMlsGroupSession';
import { encodeConversationId, getImpl } from './tsMlsShared';

export class TsMlsGroupSessionFactory implements GroupSessionFactory {
  constructor(private readonly store: TsMlsDeviceIdentityStore) {}

  async create(conversationId: ConversationId): Promise<GroupSession> {
    const impl = await getImpl();
    const credential = await this.store.getOwnCredential();
    const own = this.pickOwnKeyPackage();
    const state = await createGroup(
      encodeConversationId(conversationId),
      own.publicPackage,
      own.privatePackage,
      [],
      impl,
    );
    return new TsMlsGroupSession(conversationId, state, credential);
  }

  async restore(conversationId: ConversationId, stateBytes: Uint8Array): Promise<GroupSession> {
    const credential = await this.store.getOwnCredential();
    const groupState = decodeGroupState(stateBytes, 0)?.[0];
    if (!groupState) {
      throw new Error('Could not decode serialized group state');
    }
    if (!bytesEqual(groupState.groupContext.groupId, encodeConversationId(conversationId))) {
      // Same check joinFromWelcome already makes on a Welcome - a storage
      // bug or key collision handing this conversationId the wrong bytes
      // should fail loudly here, not silently resume as the wrong group.
      throw new CredentialMismatchError(
        `Restored state is for a different conversation than "${conversationId}"`,
      );
    }
    // encodeGroupState only serializes GroupState, not the clientConfig half
    // of ClientState (it's static config, not group state) - reattach the
    // defaults on restore, same as createGroup/joinGroup do when the caller
    // doesn't override them.
    const state: ClientState = { ...groupState, clientConfig: defaultClientConfig };
    return new TsMlsGroupSession(conversationId, state, credential);
  }

  async joinExternally(
    conversationId: ConversationId,
    groupInfoBytes: Uint8Array,
  ): Promise<{ session: GroupSession; commitBytes: Uint8Array; groupInfoBytes: Uint8Array }> {
    const decoded = decodeMlsMessage(groupInfoBytes, 0)?.[0];
    if (!decoded || decoded.wireformat !== 'mls_group_info') {
      throw new CredentialMismatchError('Bytes do not contain an MLS GroupInfo message');
    }
    if (!bytesEqual(decoded.groupInfo.groupContext.groupId, encodeConversationId(conversationId))) {
      throw new CredentialMismatchError(
        `GroupInfo is for a different conversation than "${conversationId}"`,
      );
    }

    const credential = await this.store.getOwnCredential();
    const impl = await getImpl();
    const keyPackage = await this.store.createEphemeralKeyPackage();
    const { publicMessage, newState } = await joinGroupExternal(
      decoded.groupInfo,
      keyPackage.publicPackage,
      keyPackage.privatePackage,
      false,
      impl,
    );

    return {
      session: new TsMlsGroupSession(conversationId, newState, credential),
      commitBytes: encodeMlsMessage({
        publicMessage,
        wireformat: 'mls_public_message',
        version: 'mls10',
      }),
      groupInfoBytes: await encodeGroupInfoFor(newState, impl),
    };
  }

  async joinFromWelcome(
    conversationId: ConversationId,
    welcomeBytes: Uint8Array,
    options: {
      verify?: (session: GroupSession) => Promise<void>;
      onAccepted?: (session: GroupSession) => Promise<void>;
    } = {},
  ): Promise<GroupSession> {
    const decoded = decodeMlsMessage(welcomeBytes, 0)?.[0];
    if (!decoded || decoded.wireformat !== 'mls_welcome') {
      throw new CredentialMismatchError('Bytes do not contain an MLS Welcome message');
    }

    // getOwnCredential() is also what triggers the store's lazy hydration
    // from persistent storage - must run before keyPackagesById is read
    // below, or a freshly-constructed (not yet hydrated) store would always
    // report "no matching key package" right after a reload.
    const credential = await this.store.getOwnCredential();
    const impl = await getImpl();
    const matching = await this.findMatchingKeyPackage(decoded.welcome, impl);
    if (!matching) {
      throw new CredentialMismatchError(
        'This Welcome is not addressed to any key package this device holds',
      );
    }

    // No explicit ratchetTree argument - stageCommit sets
    // ratchetTreeExtension: true, so joinGroup recovers the tree from the
    // Welcome's own GroupInfo extension.
    const state = await joinGroup(
      decoded.welcome,
      matching.publicPackage,
      matching.privatePackage,
      emptyPskIndex,
      impl,
    );

    if (!bytesEqual(state.groupContext.groupId, encodeConversationId(conversationId))) {
      throw new CredentialMismatchError(
        `Welcome is for a different conversation than "${conversationId}"`,
      );
    }

    const session = new TsMlsGroupSession(conversationId, state, credential);

    try {
      await options.verify?.(session);
    } catch (error) {
      // A definite refusal or a stale Welcome spends the package; a transport error keeps it for the retry.
      if (error instanceof MembershipMismatchError || error instanceof StaleWelcomeError) {
        await this.store.consumeKeyPackage(matching.id);
      }
      throw error;
    }

    // Spent only once the join is accepted and saved, so a failed or crashed attempt leaves it for a retry.
    await options.onAccepted?.(session);
    await this.store.consumeKeyPackage(matching.id);

    return session;
  }

  private async findMatchingKeyPackage(
    welcome: Parameters<typeof joinGroup>[0],
    impl: CiphersuiteImpl,
  ) {
    for (const stored of this.store.keyPackagesById.values()) {
      const ref = await makeKeyPackageRef(stored.publicPackage, impl.hash);
      if (welcome.secrets.some((secret) => bytesEqual(secret.newMember, ref))) {
        return stored;
      }
    }
    return undefined;
  }

  /**
   * Looked up by its FOUNDER kind, not by map/insertion order - it used to
   * just grab the first entry in keyPackagesById, relying on provision()
   * always running (and storing its package) before generateKeyPackages()
   * ever does. That worked only because the package it happened to grab
   * was never actually uploaded or claimable; an explicit kind means this
   * can't silently start returning a claimable SINGLE_USE/LAST_RESORT
   * package instead if that insertion order ever changed.
   */
  private pickOwnKeyPackage() {
    const founder = [...this.store.keyPackagesById.values()].find(
      (stored) => stored.kind === 'FOUNDER',
    );
    if (!founder) {
      throw new Error('Device has no key packages - call provision() first');
    }
    return founder;
  }
}
