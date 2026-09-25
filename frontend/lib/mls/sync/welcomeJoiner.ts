import { api } from '../../api';
import { base64ToBytes } from '../storage/base64';
import type { GroupSession, GroupSessionFactory } from '../contract/client';
import {
  CredentialMismatchError,
  MembershipMismatchError,
  StaleWelcomeError,
} from '../contract/errors';
import type { ConversationId, DeviceId, Epoch } from '../contract/types';
import type { KeyPackageSupply } from '../device/keyPackageReplenisher';
import type { CommitVerifier } from './commitVerifier';
import type { GroupProblemTracker } from './groupProblems';
import { WELCOME_PAGE_SIZE } from './handshakeLog';
import { readPage } from './pagedResponse';

interface PendingWelcome {
  id: string;
  conversationId: ConversationId;
  payload: string;
}

/** The slice of the session cache the joiner drives. */
export interface WelcomeHost {
  runExclusive<T>(conversationId: ConversationId, task: () => Promise<T>): Promise<T>;
  savedEpochIgnoringCorruption(conversationId: ConversationId): Promise<Epoch | undefined>;
  adopt(conversationId: ConversationId, session: GroupSession): Promise<void>;
}

/** Joins the groups this device has been sent a Welcome for. */
export class WelcomeJoiner {
  constructor(
    private readonly host: WelcomeHost,
    private readonly factory: GroupSessionFactory,
    private readonly verifier: CommitVerifier,
    private readonly groupProblems: GroupProblemTracker,
    private readonly deviceId: DeviceId,
    private readonly keyPackageSupply?: KeyPackageSupply,
  ) {}

  /**
   * Joins each pending Welcome and consumes it; a failed one is skipped and left unconsumed to retry.
   * A later-epoch Welcome replaces an existing session; a stale or unopenable one is consumed without joining.
   */
  async processPendingWelcomes(): Promise<{
    joined: ConversationId[];
    failures: Array<{ welcomeId: string; error: unknown }>;
  }> {
    const joined: ConversationId[] = [];
    const failures: Array<{ welcomeId: string; error: unknown }> = [];
    const seen = new Set<string>();
    let after: string | undefined;

    // A page with nothing new (only failed ones handed back) ends the loop.
    for (;;) {
      const page = readPage<PendingWelcome>(
        // eslint-disable-next-line no-await-in-loop -- each page follows the previous one's cursor
        await api.getMlsPendingWelcomes(this.deviceId, after ? { after } : undefined),
        'welcomes',
        WELCOME_PAGE_SIZE,
      );
      const fresh = page.items.filter((welcome) => !seen.has(welcome.id));
      for (const welcome of fresh) seen.add(welcome.id);

      for (const welcome of fresh) {
        try {
          // eslint-disable-next-line no-await-in-loop -- each Welcome is joined and consumed independently
          if (await this.joinFromPendingWelcome(welcome)) joined.push(welcome.conversationId);
        } catch (error) {
          // A refused group's key package is spent, so retrying this Welcome could never succeed.
          if (error instanceof MembershipMismatchError) {
            this.groupProblems.mark(welcome.conversationId, 'refused-commit');
            try {
              // eslint-disable-next-line no-await-in-loop -- best effort, one Welcome at a time
              await api.consumeMlsWelcome(this.deviceId, welcome.id);
            } catch {
              // it stays pending and is refused again next poll
            }
          }
          failures.push({ welcomeId: welcome.id, error });
        }
      }

      if (!page.hasMore || fresh.length === 0) break;
      after = page.nextCursor;
    }

    if (joined.length > 0) await this.keyPackageSupply?.maybeReplenish({ force: true });
    return { joined, failures };
  }

  // Saved before the key package is spent and consumed last, so a crash at any point leaves a state a rerun finishes.
  private joinFromPendingWelcome(welcome: PendingWelcome): Promise<boolean> {
    return this.host.runExclusive(welcome.conversationId, async () => {
      const existingEpoch = await this.host.savedEpochIgnoringCorruption(welcome.conversationId);

      try {
        await this.factory.joinFromWelcome(
          welcome.conversationId,
          base64ToBytes(welcome.payload),
          {
            verify: async (joined) => {
              if (existingEpoch !== undefined && (await joined.currentEpoch()) <= existingEpoch) {
                throw new StaleWelcomeError();
              }
              await this.verifier.assertTreeMatchesRoster(welcome.conversationId, joined);
            },
            onAccepted: (session) => this.host.adopt(welcome.conversationId, session),
          },
        );
      } catch (error) {
        const isStale =
          error instanceof StaleWelcomeError ||
          (existingEpoch !== undefined && error instanceof CredentialMismatchError);
        if (!isStale) throw error;

        // Not a newer group: consume it so it stops being handed back.
        await api.consumeMlsWelcome(this.deviceId, welcome.id);
        return false;
      }

      this.groupProblems.clear(welcome.conversationId);
      await api.consumeMlsWelcome(this.deviceId, welcome.id);
      return true;
    });
  }
}
