// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  // regression: a second message arriving mid-decrypt cancels the effect that's still
  // decrypting the first one. The old code let that cancellation suppress the first
  // message's own setDecrypted call once it finished, even though its plaintext had
  // already been saved - the message stayed stuck as if still decrypting until some
  // unrelated later event happened to re-scan the cache.
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
    // msg1's decrypt is still pending (the mock never resolved it yet).
    expect(hook.value.m1).toBeUndefined();

    // msg2 arrives - this changes the id-list dependency, cancelling the still-running effect above.
    await hook.render({ conversationId: 'conv-1', messages: [msg1, msg2], currentUserId: 'me' });
    expect(hook.value).toMatchObject({ m2: { status: 'ok' } });
    // msg1 is still legitimately in flight (owned by the cancelled effect), not lost yet.
    expect(hook.value.m1).toBeUndefined();

    // The original, "cancelled" effect's in-flight decrypt of msg1 finally finishes.
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

  // regression: once the timed retry budget (MAX_RETRY_ATTEMPTS) runs out, the message is marked
  // permanently unavailable even if the underlying cause (a network outage) was purely transient
  // and has since cleared - nothing re-triggers a recheck unless an unrelated event happens to.
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

    // Every scheduled retry keeps failing the same way, until the budget runs out.
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- each round must fully settle before the next timer is due
      await advanceAndFlush(nextRetryDelayMs(attempt));
    }

    expect(hook.value.m1).toEqual({ status: 'unavailable' });
    expect(engine.syncCommits).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

    // Connectivity returns - and so does the group, this time.
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
});
