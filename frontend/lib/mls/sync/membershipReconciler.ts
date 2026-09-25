import { api } from '../../api';
import { EpochConflictError, GroupStateUnavailableError } from '../contract/errors';
import type {
  ConversationId,
  DeviceId,
  Epoch,
  KeyPackageOffer,
  MembershipChangeRequest,
  UserId,
} from '../contract/types';
import { toKeyPackageOffer, type ClaimedKeyPackage } from './keyPackageOffer';

/** What the backend says one conversation is waiting on (POST .../membership-work). */
export interface MembershipWorkItem {
  conversationId: ConversationId;
  /** The epoch a Commit for this work must be built from. */
  epoch: Epoch;
  add: Array<{ userId: UserId; deviceId: DeviceId }>;
  remove: Array<{ userId: UserId; deviceId: DeviceId }>;
  unreachableUserIds: UserId[];
}

/** The slice of SyncEngine the reconciler drives - kept narrow so it can be tested on its own. */
export interface ReconcilerEngine {
  syncCommits(conversationId: ConversationId): Promise<Epoch>;
  submitMembershipChange(
    conversationId: ConversationId,
    change: MembershipChangeRequest,
  ): Promise<Epoch>;
}

export interface ReconcileOptions {
  /** Look at one conversation only. */
  conversationId?: ConversationId;
  /**
   * `pending` (the default) checks only conversations where someone is joining
   * or leaving - cheap enough to run often. `full` also finds a member's new
   * device, a revoked one, or a leftover one, and should run rarely.
   */
  scope?: 'pending' | 'full';
}

export type ReconcileOutcome =
  | 'committed'
  /** This device has no local copy of the group, so it cannot build a Commit for it. */
  | 'no-local-state'
  /** The group moved on (or this device could not catch up) - the work list is out of date. */
  | 'stale'
  /** Nothing usable to add or remove after claiming key packages. */
  | 'nothing-to-do'
  /** Another Commit won the epoch; the group is now caught up and the work needs recomputing. */
  | 'conflict'
  | 'failed';

export interface ReconcileSummary {
  outcomes: Array<{ conversationId: ConversationId; outcome: ReconcileOutcome }>;
}

/** Same cap as the backend's SubmitHandshakeDto and ClaimKeyPackagesQueryDto; keep in step. */
const MAX_DEVICES_PER_COMMIT = 50;
/** Recomputing after a conflict is bounded so two members racing can't loop forever. */
const MAX_PASSES = 3;
/** Pages of work fetched per pass - a guard against a server that never stops paging. */
const MAX_WORK_PAGES = 20;

/** Carries out the membership changes the server authorized: one Commit per conversation. The server decides who may be in a group; accepting the Commit completes it. */
export class MembershipReconciler {
  constructor(
    private readonly engine: ReconcilerEngine,
    private readonly deviceId: DeviceId,
  ) {}

  async reconcile(options: ReconcileOptions = {}): Promise<ReconcileSummary> {
    const outcomes: ReconcileSummary['outcomes'] = [];

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      // eslint-disable-next-line no-await-in-loop -- each pass must see the result of the previous one
      const items = await this.fetchWork(options);
      if (items.length === 0) break;

      let raced = false;
      for (const item of items) {
        // eslint-disable-next-line no-await-in-loop -- one Commit at a time: each changes the epoch the next may depend on
        const outcome = await this.reconcileConversation(item);
        outcomes.push({ conversationId: item.conversationId, outcome });
        // eslint-disable-next-line no-await-in-loop -- a few small requests, one per stuck conversation
        await this.releaseIfStuck(item.conversationId, outcome);
        raced ||= outcome === 'conflict';
      }

      if (!raced) break;
    }

    return { outcomes };
  }

  private async fetchWork(options: ReconcileOptions): Promise<MembershipWorkItem[]> {
    const items: MembershipWorkItem[] = [];
    let after: string | undefined;

    for (let page = 0; page < MAX_WORK_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor
      const response = (await api.getMlsMembershipWork(this.deviceId, {
        after,
        conversationId: options.conversationId,
        scope: options.scope,
      })) as { items: MembershipWorkItem[]; nextCursor: string | null };

      items.push(...response.items);

      if (!response.nextCursor || response.nextCursor === after) break;
      after = response.nextCursor;
    }

    return items;
  }

  /** A device that could not finish the work gives it back so another member can take it. */
  private async releaseIfStuck(
    conversationId: ConversationId,
    outcome: ReconcileOutcome,
  ): Promise<void> {
    // A Commit clears the lease itself, and a conflict means someone else's Commit did.
    if (outcome === 'committed' || outcome === 'conflict') return;

    try {
      await api.releaseMlsMembershipWork(this.deviceId, conversationId);
    } catch (error) {
      console.warn(`Could not release the lease on ${conversationId}`, error);
    }
  }

  private async reconcileConversation(item: MembershipWorkItem): Promise<ReconcileOutcome> {
    try {
      let epoch: Epoch;
      try {
        epoch = await this.engine.syncCommits(item.conversationId);
      } catch (error) {
        if (error instanceof GroupStateUnavailableError) return 'no-local-state';
        throw error;
      }

      // Claiming burns single-use key packages, so only do it once this
      // device is sure it is looking at the epoch the server computed the work for.
      if (epoch !== item.epoch) return 'stale';

      const added = await this.claimOffers(item);
      const removed = item.remove.slice(0, MAX_DEVICES_PER_COMMIT);

      if (added.length === 0 && removed.length === 0) return 'nothing-to-do';

      await this.engine.submitMembershipChange(item.conversationId, { added, removed });
      return 'committed';
    } catch (error) {
      if (error instanceof EpochConflictError) return 'conflict';
      console.warn(`Could not finish membership change for ${item.conversationId}`, error);
      return 'failed';
    }
  }

  /** Claims key packages user by user, at most one Commit's worth, counting devices first so nothing claimed is left unused. */
  private async claimOffers(item: MembershipWorkItem): Promise<KeyPackageOffer[]> {
    const devicesByUser = new Map<UserId, DeviceId[]>();
    for (const device of item.add) {
      devicesByUser.set(device.userId, [
        ...(devicesByUser.get(device.userId) ?? []),
        device.deviceId,
      ]);
    }

    const offers: KeyPackageOffer[] = [];

    for (const [userId, allDeviceIds] of devicesByUser) {
      // A user who does not fit beside others waits for a later Commit; one too big for any Commit is cut to the cap.
      if (offers.length > 0 && offers.length + allDeviceIds.length > MAX_DEVICES_PER_COMMIT) continue;
      const deviceIds = allDeviceIds.slice(0, MAX_DEVICES_PER_COMMIT - offers.length);

      let claimed: ClaimedKeyPackage[];
      try {
        // eslint-disable-next-line no-await-in-loop -- claims are sequential so the limit is never overshot by parallel requests
        claimed = (await api.claimChatDeviceKeyPackages(userId, {
          conversationId: item.conversationId,
          // Only the devices counted above: one registered since would be claimed and wasted.
          deviceIds,
        })) as ClaimedKeyPackage[];
      } catch (error) {
        console.warn(`Could not claim key packages for ${userId}`, error);
        continue;
      }

      offers.push(...claimed.map((keyPackage) => toKeyPackageOffer(userId, keyPackage)));
    }

    return offers;
  }
}
