// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMembershipEvents } from './useMembershipEvents';

const { list, subscribe } = vi.hoisted(() => ({
  list: vi.fn(),
  subscribe: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock('../lib/mls/sync/sharedMembershipEventLog', () => ({
  membershipEventLog: { list, subscribe },
}));

function Harness({ onValue }: { onValue: (value: unknown) => void }) {
  onValue(useMembershipEvents('conv-1'));
  return null;
}

async function mount(onValue: (value: unknown) => void) {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(createElement(Harness, { onValue }));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  return root;
}

describe('useMembershipEvents', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the stored events', async () => {
    list.mockResolvedValue([{ id: 'a' }]);
    let latest: unknown;

    const root = await mount((value) => (latest = value));

    expect(latest).toEqual([{ id: 'a' }]);
    act(() => root.unmount());
  });

  it('says so when the events cannot be loaded, and shows none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    list.mockRejectedValue(new Error('idb closed'));
    let latest: unknown;

    const root = await mount((value) => (latest = value));

    expect(latest).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Could not load membership notices', expect.any(Error));
    act(() => root.unmount());
  });
});
