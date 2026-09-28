// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSafetyNumbers, type SafetyNumbers } from './useSafetyNumbers';

const { listLeaves, engine } = vi.hoisted(() => {
  const listLeaves = vi.fn();
  return { listLeaves, engine: { listLeaves } };
});
vi.mock('./useSyncEngine', () => ({ useSyncEngine: () => engine }));
vi.mock('../lib/mls/verification/verifiedPeerStore', async () => {
  const actual = await vi.importActual<typeof import('../lib/mls/verification/verifiedPeerStore')>(
    '../lib/mls/verification/verifiedPeerStore',
  );
  return { ...actual, EncryptedIndexedDbVerifiedPeerStore: actual.InMemoryVerifiedPeerStore };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const leaves = [
  { userId: 'alice', deviceId: 'a1', signatureKey: new Uint8Array([1]) },
  { userId: 'bob', deviceId: 'b1', signatureKey: new Uint8Array([2]) },
];
const PEERS = ['bob'];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function mount() {
  const root = createRoot(document.createElement('div'));
  let latest = {} as SafetyNumbers;
  function Harness({ conversationId }: { conversationId: string }) {
    latest = useSafetyNumbers(conversationId, 'alice', PEERS);
    return null;
  }
  return {
    get value() {
      return latest;
    },
    render: async (conversationId: string) => {
      await act(async () => root.render(createElement(Harness, { conversationId })));
      await flush();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe('useSafetyNumbers', () => {
  afterEach(() => vi.clearAllMocks());

  it('drops the previous conversation numbers at once when the conversation changes', async () => {
    listLeaves.mockResolvedValueOnce(leaves).mockReturnValueOnce(new Promise(() => undefined));
    const hook = mount();
    await hook.render('c1');
    expect(hook.value.byUser['bob']?.pairNumber).toBeDefined();

    await hook.render('c2');

    expect(hook.value.byUser).toEqual({});
    await hook.unmount();
  });

  it('reports a read failure as an error, not as missing numbers, and recovers on retry', async () => {
    listLeaves.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(leaves);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hook = mount();
    await hook.render('c1');
    expect(hook.value.hasError).toBe(true);

    await act(async () => void hook.value.retry());
    await flush();

    expect(hook.value.hasError).toBe(false);
    expect(hook.value.byUser['bob']?.pairNumber).toBeDefined();
    await hook.unmount();
  });

  it('shows verified after verify even when a refresh was already in flight', async () => {
    listLeaves.mockResolvedValue(leaves);
    const hook = mount();
    await hook.render('c1');

    await act(async () => {
      void hook.value.retry();
      await hook.value.verify('bob');
    });
    await flush();

    expect(hook.value.byUser['bob']?.status).toBe('verified');
    await hook.unmount();
  });

  it('shows new-device after the peer adds a device and verified again once re-verified', async () => {
    listLeaves.mockResolvedValue(leaves);
    const hook = mount();
    await hook.render('c1');
    await act(async () => void (await hook.value.verify('bob')));
    await flush();
    expect(hook.value.byUser['bob']?.status).toBe('verified');

    listLeaves.mockResolvedValue([...leaves, { userId: 'bob', deviceId: 'b2', signatureKey: new Uint8Array([3]) }]);
    await act(async () => void (await hook.value.retry()));
    await flush();
    expect(hook.value.byUser['bob']?.status).toBe('new-device');

    await act(async () => void (await hook.value.verify('bob')));
    await flush();
    expect(hook.value.byUser['bob']?.status).toBe('verified');
    await hook.unmount();
  });
});
