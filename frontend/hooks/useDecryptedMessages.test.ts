// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupStateCorruptedError } from '../lib/mls/contract/errors';
import { MAX_RETRY_ATTEMPTS, nextRetryDelayMs } from '../lib/mls/messaging/decryptRetry';
import { useDecryptedMessages } from './useDecryptedMessages';

const { plaintextGet, plaintextSave } = vi.hoisted(() => ({
  plaintextGet: vi.fn(),
  plaintextSave: vi.fn(),
}));

vi.mock('../lib/mls/storage/messagePlaintextStore', () => ({
  EncryptedIndexedDbMessagePlaintextStore: vi.fn().mockImplementation(function FakeStore() {
    return { get: plaintextGet, save: plaintextSave };
  }),
}));

vi.mock('./useSyncEngine', () => ({ useSyncEngine: vi.fn() }));
vi.mock('./useDeviceIdentity', () => ({ useDeviceIdentity: vi.fn() }));

import { useSyncEngine } from './useSyncEngine';
import { useDeviceIdentity } from './useDeviceIdentity';

function fakeEngine() {
  return {
    isAtCurrentEpoch: vi.fn(),
    syncCommits: vi.fn(),
    processPendingWelcomes: vi.fn(),
    processIncoming: vi.fn(),
    recoverUnreadableGroup: vi.fn().mockResolvedValue(false),
    recoveryWaitMs: vi.fn().mockReturnValue(0),
  };
}

function message(id: string) {
  return { id, senderId: 'other-user', ciphertext: btoa(`ciphertext-${id}`) };
}

/** Renders useDecryptedMessages via a tiny host component - no @testing-library needed for this. */
function renderHook() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let latest: Record<string, unknown> = {};

  function Harness(props: { conversationId: string; messages: unknown[]; currentUserId: string }) {
    latest = useDecryptedMessages(props.conversationId as never, props.messages as never, props.currentUserId);
    return null;
  }

  return {
    get value() {
      return latest;
    },
    render: async (props: { conversationId: string; messages: unknown[]; currentUserId: string }) => {
      await act(async () => {
        root.render(createElement(Harness, props));
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      });
    },
    unmount: () => act(() => root.unmount()),
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

describe('useDecryptedMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plaintextGet.mockResolvedValue(undefined);
    plaintextSave.mockResolvedValue(undefined);
    vi.mocked(useDeviceIdentity).mockReturnValue({
      credential: { deviceId: 'device-1' },
      isReady: true,
      error: undefined,
      retry: vi.fn(),
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // regression: a cancelled effect must still settle its in-flight message.
  it('does not lose a message an in-flight decrypt finishes for after a newer effect superseded it', async () => {
    const engine = fakeEngine();
    engine.isAtCurrentEpoch.mockResolvedValue(true);
    vi.mocked(useSyncEngine).mockReturnValue(engine as never);

    let resolveFirst: (value: unknown) => void = () => undefined;
    engine.processIncoming.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    engine.processIncoming.mockImplementation(async () => ({
      kind: 'application',
      senderDeviceId: 'device-2',
      epoch: 0,
      envelope: { v: 1, type: 'text', body: 'second' },
    }));

    const msg1 = message('m1');
    const msg2 = message('m2');
    const hook = renderHook();

    await hook.render({ conversationId: 'conv-1', messages: [msg1], currentUserId: 'me' });
    expect(hook.value.m1).toBeUndefined();

    await hook.render({ conversationId: 'conv-1', messages: [msg1, msg2], currentUserId: 'me' });
    expect(hook.value).toMatchObject({ m2: { status: 'ok' } });
    expect(hook.value.m1).toBeUndefined();

    await act(async () => {
      resolveFirst({
        kind: 'application',
        senderDeviceId: 'device-3',
        epoch: 0,
        envelope: { v: 1, type: 'text', body: 'first' },
      });
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(hook.value).toMatchObject({
      m1: { status: 'ok', envelope: { body: 'first' } },
      m2: { status: 'ok', envelope: { body: 'second' } },
    });
    expect(plaintextSave).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', envelope: { v: 1, type: 'text', body: 'first' } }),
    );

    hook.unmount();
  });

  // regression: the decrypted map is pruned when switching conversations.
  it('clears previously decrypted entries when the conversation changes', async () => {
    const engine = fakeEngine();
    engine.isAtCurrentEpoch.mockResolvedValue(true);
    engine.processIncoming.mockResolvedValue({
      kind: 'application',
      senderDeviceId: 'device-2',
      epoch: 0,
      envelope: { v: 1, type: 'text', body: 'hi' },
    });
    vi.mocked(useSyncEngine).mockReturnValue(engine as never);

    const msgInA = message('a1');
    const hook = renderHook();

    await hook.render({ conversationId: 'conv-a', messages: [msgInA], currentUserId: 'me' });
    expect(hook.value).toMatchObject({ a1: { status: 'ok' } });

    const msgInB = message('b1');
    await hook.render({ conversationId: 'conv-b', messages: [msgInB], currentUserId: 'me' });

    expect(hook.value.a1).toBeUndefined();
    expect(hook.value).toMatchObject({ b1: { status: 'ok' } });

    hook.unmount();
  });

  // regression: a message left unavailable after the retry budget is rechecked once connectivity returns.
  it('retries a message left unavailable by an exhausted timed budget once the browser regains connectivity', async () => {
    vi.useFakeTimers();
    const engine = fakeEngine();
    engine.isAtCurrentEpoch.mockResolvedValue(false); // always behind - forces a sync attempt every round
    const networkError = new Error('network down');
    engine.syncCommits.mockRejectedValue(networkError);
    engine.processIncoming.mockRejectedValue(new Error('not caught up yet'));
    vi.mocked(useSyncEngine).mockReturnValue(engine as never);

    const msg = message('m1');
    const hook = renderHook();

    async function advanceAndFlush(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      });
    }

    await hook.render({ conversationId: 'conv-1', messages: [msg], currentUserId: 'me' });
    expect(hook.value.m1).toEqual({ status: 'pending' });

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- each round must fully settle before the next timer is due
      await advanceAndFlush(nextRetryDelayMs(attempt));
    }

    expect(hook.value.m1).toEqual({ status: 'unavailable' });
    expect(engine.syncCommits).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

    engine.syncCommits.mockResolvedValue(0 as never);
    engine.isAtCurrentEpoch.mockResolvedValue(true);
    engine.processIncoming.mockResolvedValue({
      kind: 'application',
      senderDeviceId: 'device-2',
      epoch: 0,
      envelope: { v: 1, type: 'text', body: 'caught up' },
    });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(hook.value.m1).toEqual({
      status: 'ok',
      envelope: { v: 1, type: 'text', body: 'caught up' },
    });

    hook.unmount();
  });
  // regression: a run still finishing for the old conversation scheduled a retry that re-ran the new one
  it('does not let a run from the previous conversation schedule retries for the new one', async () => {
    vi.useFakeTimers();
    const engine = fakeEngine();
    engine.isAtCurrentEpoch.mockImplementation(async (conversationId: string) => conversationId === 'conv-b');
    engine.syncCommits.mockRejectedValue(new Error('network down'));
    let failA: (error: Error) => void = () => undefined;
    engine.processIncoming.mockImplementation((conversationId: string) =>
      conversationId === 'conv-a'
        ? new Promise((_resolve, reject) => (failA = reject))
        : Promise.resolve({
            kind: 'application',
            senderDeviceId: 'device-2',
            epoch: 0,
            envelope: { v: 1, type: 'text', body: 'in b' },
          }),
    );
    vi.mocked(useSyncEngine).mockReturnValue(engine as never);
    const hook = renderHook();

    await hook.render({ conversationId: 'conv-a', messages: [message('a1')], currentUserId: 'me' });
    await hook.render({ conversationId: 'conv-b', messages: [message('b1')], currentUserId: 'me' });
    expect(hook.value).toMatchObject({ b1: { status: 'ok' } });
    const decryptsInB = engine.processIncoming.mock.calls.filter(([id]) => id === 'conv-b').length;

    // the old conversation's decrypt fails only now, which would schedule a retry
    await act(async () => {
      failA(new Error('not caught up'));
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(nextRetryDelayMs(0) + 1_000);
    });

    expect(engine.processIncoming.mock.calls.filter(([id]) => id === 'conv-b')).toHaveLength(
      decryptsInB,
    );
    hook.unmount();
  });

  describe('a group that could not be recovered yet', () => {
    async function advanceAndFlush(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      });
    }

    it('keeps the message pending and tries once more when the recovery cooldown ends', async () => {
      vi.useFakeTimers();
      const engine = fakeEngine();
      engine.isAtCurrentEpoch.mockResolvedValue(false);
      engine.recoveryWaitMs.mockReturnValue(30_000);
      engine.syncCommits.mockRejectedValueOnce(new GroupStateCorruptedError('conv-1'));
      engine.syncCommits.mockResolvedValue(1 as never);
      engine.processIncoming.mockRejectedValueOnce(new Error('no group'));
      engine.processIncoming.mockResolvedValue({
        kind: 'application',
        senderDeviceId: 'device-2',
        epoch: 1,
        envelope: { v: 1, type: 'text', body: 'after the cooldown' },
      });
      vi.mocked(useSyncEngine).mockReturnValue(engine as never);
      const hook = renderHook();

      await hook.render({ conversationId: 'conv-1', messages: [message('m1')], currentUserId: 'me' });
      expect(hook.value.m1).toEqual({ status: 'pending' });

      await advanceAndFlush(29_000);
      expect(engine.syncCommits).toHaveBeenCalledTimes(1);
      await advanceAndFlush(2_000);

      expect(engine.syncCommits).toHaveBeenCalledTimes(2);
      expect(hook.value.m1).toMatchObject({ status: 'ok' });
      hook.unmount();
    });

    it('waits for the cooldown only once, then settles as unavailable', async () => {
      vi.useFakeTimers();
      const engine = fakeEngine();
      engine.isAtCurrentEpoch.mockResolvedValue(false);
      engine.recoveryWaitMs.mockReturnValue(30_000);
      engine.syncCommits.mockRejectedValue(new GroupStateCorruptedError('conv-1'));
      engine.processIncoming.mockRejectedValue(new Error('no group'));
      vi.mocked(useSyncEngine).mockReturnValue(engine as never);
      const hook = renderHook();

      await hook.render({ conversationId: 'conv-1', messages: [message('m1')], currentUserId: 'me' });
      await advanceAndFlush(31_000);
      await advanceAndFlush(600_000);

      expect(engine.syncCommits).toHaveBeenCalledTimes(2);
      expect(hook.value.m1).toEqual({ status: 'unavailable' });
      hook.unmount();
    });

    it('settles at once when no cooldown is running, since waiting would change nothing', async () => {
      const engine = fakeEngine();
      engine.isAtCurrentEpoch.mockResolvedValue(false);
      engine.syncCommits.mockRejectedValue(new GroupStateCorruptedError('conv-1'));
      engine.processIncoming.mockRejectedValue(new Error('no group'));
      vi.mocked(useSyncEngine).mockReturnValue(engine as never);
      const hook = renderHook();

      await hook.render({ conversationId: 'conv-1', messages: [message('m1')], currentUserId: 'me' });

      expect(hook.value.m1).toEqual({ status: 'unavailable' });
      hook.unmount();
    });
  });
});
