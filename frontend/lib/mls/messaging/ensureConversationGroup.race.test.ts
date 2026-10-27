import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TsMlsDeviceIdentityStore, TsMlsGroupSessionFactory } from '../adapter/tsMlsAdapter';
import { GroupCreationLostError } from '../contract/errors';
import { bytesToBase64 } from '../storage/base64';
import { InMemoryGroupSessionStorage } from '../storage/groupSessionStorage';
import { SyncEngine } from '../sync/syncEngine';
import { ensureConversationGroup } from './ensureConversationGroup';

vi.mock('../../api', () => ({
  api: {
    claimChatDeviceKeyPackages: vi.fn(),
    submitMlsHandshake: vi.fn(),
    getMlsHandshakesSince: vi.fn(),
    getMlsPendingWelcomes: vi.fn(),
    consumeMlsWelcome: vi.fn(),
    reportMlsFault: vi.fn(),
    getMlsRoster: vi.fn(),
    getMlsGroupInfo: vi.fn(),
    getMlsJoinableConversations: vi.fn(),
    submitMlsExternalJoin: vi.fn(),
  },
}));

const CONVERSATION = 'conv-1';

interface Device {
  engine: SyncEngine;
  store: TsMlsDeviceIdentityStore;
  userId: string;
  deviceId: string;
  signatureKey: Uint8Array;
}

async function setUpDevice(userId: string): Promise<Device> {
  const store = new TsMlsDeviceIdentityStore();
  const credential = await store.provision(userId);
  const factory = new TsMlsGroupSessionFactory(store);
  const engine = new SyncEngine(factory, credential.deviceId, userId, new InMemoryGroupSessionStorage());
  return { engine, store, userId, deviceId: credential.deviceId, signatureKey: credential.signatureKey };
}

/** A server that takes the first Commit for each epoch and answers a late one with the winner, as the real one does. */
async function serveFirstCommitWins(devices: Device[]) {
  const { api } = await import('../../api');
  const handshakes: Array<{ epoch: number; payload: string; senderDeviceId: string; id: string }> = [];
  const welcomes: Array<{ id: string; conversationId: string; payload: string; createdAt: string }> = [];

  const keyPackages = new Map<string, unknown>();
  for (const device of devices) {
    const [keyPackage] = await device.store.generateKeyPackages(1);
    keyPackages.set(device.userId, {
      deviceId: device.deviceId,
      ciphersuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
      signaturePublicKey: bytesToBase64(device.signatureKey),
      payload: bytesToBase64(keyPackage!),
    });
  }
  vi.mocked(api.claimChatDeviceKeyPackages).mockImplementation(
    async (userId: string, options?: { excludeDeviceId?: string }) => {
      const claim = keyPackages.get(userId) as { deviceId: string } | undefined;
      return claim && claim.deviceId !== options?.excludeDeviceId ? [claim] : [];
    },
  );
  vi.mocked(api.getMlsPendingWelcomes).mockImplementation(async () => welcomes as never);
  vi.mocked(api.getMlsRoster).mockImplementation(async (_conversation: string, epoch: number) => ({
    epoch,
    leaves: devices.map((device) => ({
      deviceId: device.deviceId,
      userId: device.userId,
      signaturePublicKey: bytesToBase64(device.signatureKey),
    })),
  }) as never);
  vi.mocked(api.getMlsHandshakesSince).mockImplementation(
    async (_conversation: string, sinceEpoch = 0) =>
      ({ items: handshakes.filter((entry) => entry.epoch >= sinceEpoch), hasMore: false }) as never,
  );
  vi.mocked(api.submitMlsHandshake).mockImplementation(async (_conversationId, request) => {
    const shaped = (entry: (typeof handshakes)[number]) => ({
      ...entry,
      membershipDeclared: false,
      addedDevices: [],
      removedDevices: [],
      conversationId: CONVERSATION,
      createdAt: new Date().toISOString(),
    });
    const winner = handshakes.find((entry) => entry.epoch === request.epoch);
    if (winner) return { outcome: 'conflict', handshake: shaped(winner) } as never;

    const entry = {
      id: `hs-${request.epoch}`,
      epoch: request.epoch,
      payload: request.payload,
      senderDeviceId: request.deviceId,
    };
    handshakes.push(entry);
    if (request.welcome) {
      welcomes.push({
        id: `welcome-${request.epoch}`,
        conversationId: CONVERSATION,
        payload: request.welcome.payload,
        createdAt: new Date().toISOString(),
      });
    }
    return { outcome: 'accepted', handshake: shaped(entry) } as never;
  });
}

describe('two people send into a brand-new chat at the same moment (real MLS)', () => {
  beforeEach(() => vi.clearAllMocks());

  // #123: each side finds no group on its own device, creates one, and tries to add the other.
  // The late Commit used to come back as the winning one, belong to a different group, and fail to apply.
  it('ends with both of them in one group, and neither seeing a commit error', async () => {
    const alice = await setUpDevice('user-alice');
    const bob = await setUpDevice('user-bob');
    await serveFirstCommitWins([alice, bob]);

    const results = await Promise.allSettled([
      ensureConversationGroup(alice.engine, CONVERSATION, 'user-bob'),
      ensureConversationGroup(bob.engine, CONVERSATION, 'user-alice'),
    ]);

    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures.map((failure) => String((failure as PromiseRejectedResult).reason))).toEqual([]);
  });

  it('fails the send, with no stray group left behind, while the Welcome has not arrived, and works on the retry', async () => {
    const { api } = await import('../../api');
    const alice = await setUpDevice('user-alice');
    const bob = await setUpDevice('user-bob');
    await serveFirstCommitWins([alice, bob]);
    const arrived = vi.mocked(api.getMlsPendingWelcomes).getMockImplementation()!;
    vi.mocked(api.getMlsGroupInfo).mockResolvedValue(null as never);
    vi.mocked(api.getMlsJoinableConversations).mockResolvedValue([] as never);
    await ensureConversationGroup(alice.engine, CONVERSATION, 'user-bob');
    // Bob loses the race for a chat Alice already made, and her Welcome is not visible to him yet
    vi.mocked(api.getMlsPendingWelcomes).mockResolvedValue([] as never);

    await expect(ensureConversationGroup(bob.engine, CONVERSATION, 'user-alice')).rejects.toBeInstanceOf(
      GroupCreationLostError,
    );
    await expect(bob.engine.getCurrentEpoch(CONVERSATION)).rejects.toThrow();

    vi.mocked(api.getMlsPendingWelcomes).mockImplementation(arrived);
    await expect(ensureConversationGroup(bob.engine, CONVERSATION, 'user-alice')).resolves.toBeUndefined();
    await expect(bob.engine.getCurrentEpoch(CONVERSATION)).resolves.toBe(1);
  });

  it('lets the one that lost read what the winner sends, and answer', async () => {
    const alice = await setUpDevice('user-alice');
    const bob = await setUpDevice('user-bob');
    await serveFirstCommitWins([alice, bob]);
    await Promise.all([
      ensureConversationGroup(alice.engine, CONVERSATION, 'user-bob'),
      ensureConversationGroup(bob.engine, CONVERSATION, 'user-alice'),
    ]);

    const toBob = await alice.engine.encryptMessage(CONVERSATION, { v: 1, type: 'text', body: 'hi bob' });
    const toAlice = await bob.engine.encryptMessage(CONVERSATION, { v: 1, type: 'text', body: 'hi alice' });
    const bobReads = await bob.engine.processIncoming(CONVERSATION, toBob.wireBytes);
    const aliceReads = await alice.engine.processIncoming(CONVERSATION, toAlice.wireBytes);

    const text = (result: typeof bobReads) =>
      result.kind === 'application' && 'body' in result.envelope ? result.envelope.body : result.kind;
    expect([text(bobReads), text(aliceReads)]).toEqual(['hi bob', 'hi alice']);
  });

  it('does not report the winning Commit as a fault, since nothing was wrong with it', async () => {
    const { api } = await import('../../api');
    const alice = await setUpDevice('user-alice');
    const bob = await setUpDevice('user-bob');
    await serveFirstCommitWins([alice, bob]);

    await Promise.all([
      ensureConversationGroup(alice.engine, CONVERSATION, 'user-bob'),
      ensureConversationGroup(bob.engine, CONVERSATION, 'user-alice'),
    ]);

    expect(api.reportMlsFault).not.toHaveBeenCalled();
  });
});

describe('a message sent before the other person opens the chat (real MLS)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('can be read by them once they join', async () => {
    const alice = await setUpDevice('user-alice');
    const bob = await setUpDevice('user-bob');
    await serveFirstCommitWins([alice, bob]);

    await ensureConversationGroup(alice.engine, CONVERSATION, 'user-bob');
    const sent = [];
    for (const body of ['what up my guy', 'second', 'third']) {
      sent.push(await alice.engine.encryptMessage(CONVERSATION, { v: 1, type: 'text', body }));
    }

    await bob.engine.processPendingWelcomes();
    const read = [];
    for (const message of sent) {
      const result = await bob.engine.processIncoming(CONVERSATION, message.wireBytes);
      read.push(result.kind === 'application' && 'body' in result.envelope ? result.envelope.body : result.kind);
    }

    expect(read).toEqual(['what up my guy', 'second', 'third']);
  });
});

describe('messages sent back to back (real MLS)', () => {
  beforeEach(() => vi.clearAllMocks());

  const bodyOf = (result: { kind: string; envelope?: unknown }) =>
    result.kind === 'application' && result.envelope && 'body' in (result.envelope as object)
      ? (result.envelope as { body: string }).body
      : result.kind;

  // #118: every one of them has to be readable, whatever order or overlap they are decrypted in.
  it.each([
    ['in order', (list: unknown[]) => list],
    ['in reverse order', (list: unknown[]) => [...list].reverse()],
  ])('are all read by the receiver when sent at once and decrypted at once, %s', async (_name, arrange) => {
    const alice = await setUpDevice('user-alice');
    const bob = await setUpDevice('user-bob');
    await serveFirstCommitWins([alice, bob]);
    await ensureConversationGroup(alice.engine, CONVERSATION, 'user-bob');
    await bob.engine.processPendingWelcomes();

    const bodies = ['one', 'two', 'three', 'four', 'five'];
    const sent = await Promise.all(
      bodies.map((body) => alice.engine.encryptMessage(CONVERSATION, { v: 1, type: 'text', body })),
    );
    const read = await Promise.all(
      (arrange(sent) as typeof sent).map((message) => bob.engine.processIncoming(CONVERSATION, message.wireBytes)),
    );

    expect(read.map(bodyOf).sort()).toEqual([...bodies].sort());
  });
});

describe('the receiver of a brand-new chat gets two messages while still joining (real MLS)', () => {
  beforeEach(() => vi.clearAllMocks());

  // Same steps as useDecryptedMessages: catch up (fetching the Welcome when there is no group), then decrypt.
  async function readOne(receiver: Device, wireBytes: Uint8Array) {
    try {
      await receiver.engine.syncCommits(CONVERSATION);
    } catch {
      await receiver.engine.processPendingWelcomes();
      await receiver.engine.syncCommits(CONVERSATION);
    }
    const result = await receiver.engine.processIncoming(CONVERSATION, wireBytes);
    return result.kind === 'application' && 'body' in result.envelope ? result.envelope.body : result.kind;
  }

  it('reads both when two decrypt runs start before the group exists', async () => {
    const alice = await setUpDevice('user-alice');
    const bob = await setUpDevice('user-bob');
    await serveFirstCommitWins([alice, bob]);
    await ensureConversationGroup(alice.engine, CONVERSATION, 'user-bob');
    const first = await alice.engine.encryptMessage(CONVERSATION, { v: 1, type: 'text', body: 'Yo my friend' });
    const second = await alice.engine.encryptMessage(CONVERSATION, { v: 1, type: 'text', body: 'second' });

    const settled = await Promise.allSettled([readOne(bob, first.wireBytes), readOne(bob, second.wireBytes)]);

    expect(settled.map((s) => (s.status === 'fulfilled' ? s.value : String(s.reason)))).toEqual(['Yo my friend', 'second']);
  });
});
