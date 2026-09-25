import type { ConversationId } from '../contract/types';
import type { MembershipEventStorage } from '../storage/membershipEventStorage';
import { onMlsSecretsWiped } from '../storage/mlsEncryptedStore';
import type { MembershipEvent } from './membershipEvents';

/** Every membership event this device verified, per conversation, with change notification for the UI. */
export class MembershipEventLog {
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | undefined;
  private readonly stopWipeListener: () => void;

  /** `channelName` links tabs so a write in one refreshes the others; omitted or unsupported = this tab only. */
  constructor(
    private readonly storage: MembershipEventStorage,
    channelName?: string,
  ) {
    if (channelName && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = () => this.notify();
    }
    // A wipe empties the stored events, so listeners reload instead of showing the wiped ones
    this.stopWipeListener = onMlsSecretsWiped(() => this.notify());
  }

  list(conversationId: ConversationId): Promise<MembershipEvent[]> {
    return this.storage.load(conversationId);
  }

  /** Adds events not stored yet (by id); a repeat, from this tab or another, is a no-op. */
  async record(events: MembershipEvent[]): Promise<void> {
    if (events.length === 0) return;

    const fresh = await this.storage.add(events);
    if (fresh.length === 0) return;

    this.notify();
    this.channel?.postMessage('changed');
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  close(): void {
    this.stopWipeListener();
    this.channel?.close();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
