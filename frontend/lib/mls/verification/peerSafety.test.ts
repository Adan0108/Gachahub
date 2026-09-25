import { describe, expect, it } from 'vitest';
import { computePeerSafety, verifyPeer } from './peerSafety';
import { InMemoryVerifiedPeerStore } from './verifiedPeerStore';
import type { DeviceCredential } from '../contract/types';

const key = { ownUserId: 'alice', peerUserId: 'bob' };
const leaf = (userId: string, deviceId: string, byte: number): DeviceCredential => ({
  userId,
  deviceId,
  signatureKey: new Uint8Array([byte]),
});
const alice = leaf('alice', 'a1', 1);
const bobLeaves = (...pairs: [string, number][]) => pairs.map(([id, byte]) => leaf('bob', id, byte));
const statusIn = async (store: InMemoryVerifiedPeerStore, leaves: DeviceCredential[]) =>
  (await computePeerSafety(store, 'alice', ['bob'], leaves)).bob!;

async function verifiedStore(...pairs: [string, number][]) {
  const store = new InMemoryVerifiedPeerStore();
  await verifyPeer(store, key, (await statusIn(store, [alice, ...bobLeaves(...pairs)])).devices);
  return store;
}

describe('computePeerSafety', () => {
  it('is unverified with numbers before any verification', async () => {
    const bob = await statusIn(new InMemoryVerifiedPeerStore(), [alice, ...bobLeaves(['b1', 10])]);
    expect(bob.status).toBe('unverified');
    expect(bob.pairNumber).toMatch(/^(\d{5} ){11}\d{5}$/);
  });

  it('gives both sides the same pair number', async () => {
    const leaves = [alice, ...bobLeaves(['b1', 10], ['b2', 11])];
    const fromAlice = await computePeerSafety(new InMemoryVerifiedPeerStore(), 'alice', ['bob'], leaves);
    const fromBob = await computePeerSafety(new InMemoryVerifiedPeerStore(), 'bob', ['alice'], leaves);
    expect(fromAlice.bob!.pairNumber).toBe(fromBob.alice!.pairNumber);
    expect(fromAlice.bob!.yourNumber).toBe(fromBob.alice!.theirNumber);
  });

  it('gives the same pair number whatever the leaf order', async () => {
    const leaves = [alice, ...bobLeaves(['b1', 10], ['b2', 11])];
    const a = await statusIn(new InMemoryVerifiedPeerStore(), leaves);
    const b = await statusIn(new InMemoryVerifiedPeerStore(), [...leaves].reverse());
    expect(a.pairNumber).toBe(b.pairNumber);
  });

  it('shows verified after verifying', async () => {
    const store = await verifiedStore(['b1', 10]);
    expect((await statusIn(store, [alice, ...bobLeaves(['b1', 10])])).status).toBe('verified');
  });

  it('shows new-device, not changed, when the peer adds a device', async () => {
    const store = await verifiedStore(['b1', 10]);
    const bob = await statusIn(store, [alice, ...bobLeaves(['b1', 10], ['b2', 11])]);
    expect(bob.status).toBe('new-device');
  });

  it('ignores a retired verified device', async () => {
    const store = await verifiedStore(['b1', 10], ['b2', 11]);
    expect((await statusIn(store, [alice, ...bobLeaves(['b1', 10])])).status).toBe('verified');
  });

  it('raises changed when a verified device id presents a different key', async () => {
    const store = await verifiedStore(['b1', 10]);
    expect((await statusIn(store, [alice, ...bobLeaves(['b1', 99])])).status).toBe('changed');
  });

  it('is verified again after re-verifying a changed device', async () => {
    const store = await verifiedStore(['b1', 10]);
    const changed = await statusIn(store, [alice, ...bobLeaves(['b1', 99])]);
    await verifyPeer(store, key, changed.devices);
    expect((await statusIn(store, [alice, ...bobLeaves(['b1', 99])])).status).toBe('verified');
  });

  it('keeps earlier verified devices when verifying a newly added one', async () => {
    const store = await verifiedStore(['b1', 10]);
    const both = [alice, ...bobLeaves(['b1', 10], ['b2', 11])];
    await verifyPeer(store, key, (await statusIn(store, both)).devices);
    expect((await statusIn(store, both)).status).toBe('verified');
    expect((await statusIn(store, [alice, ...bobLeaves(['b2', 11])])).status).toBe('verified');
  });

  it('is conversation-independent: verified in one leaf set stays verified in another', async () => {
    const store = await verifiedStore(['b1', 10]);
    const group = [alice, leaf('carol', 'c1', 5), ...bobLeaves(['b1', 10])];
    expect((await statusIn(store, group)).status).toBe('verified');
  });

  it('gives no numbers and is unverified when there are no local leaves', async () => {
    const store = await verifiedStore(['b1', 10]);
    const result = await computePeerSafety(store, 'alice', ['bob'], undefined);
    expect(result.bob!).toEqual({ status: 'unverified', devices: [] });
  });

  it('does not write while computing', async () => {
    const store = new InMemoryVerifiedPeerStore();
    await statusIn(store, [alice, ...bobLeaves(['b1', 10])]);
    await expect(store.get(key)).resolves.toBeUndefined();
  });
});
