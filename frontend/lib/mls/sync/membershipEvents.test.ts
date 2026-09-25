import { describe, expect, it } from 'vitest';
import { deriveMembershipEvents } from './membershipEvents';
import type { DeviceCredential } from '../contract/types';

const key = new Uint8Array([1]);
const device = (userId: string, deviceId: string): DeviceCredential => ({
  userId,
  deviceId,
  signatureKey: key,
});

const derive = (
  change: { added?: DeviceCredential[]; removed?: DeviceCredential[] },
  leavesAfter: DeviceCredential[] | undefined,
) =>
  deriveMembershipEvents({
    conversationId: 'conv-1',
    epoch: 4,
    at: 1000,
    change: { added: change.added ?? [], removed: change.removed ?? [] },
    leavesAfter,
    ownDeviceId: 'me-1',
  });

describe('deriveMembershipEvents', () => {
  it('reports a first device as a join', () => {
    const bob = device('bob', 'bob-1');
    expect(derive({ added: [bob] }, [device('me', 'me-1'), bob])).toEqual([
      {
        id: '4:joined:bob:bob-1',
        conversationId: 'conv-1',
        epoch: 4,
        kind: 'joined',
        userId: 'bob',
        deviceId: 'bob-1',
        at: 1000,
      },
    ]);
  });

  it('reports one join for a person added with several devices at once', () => {
    const [a, b] = [device('bob', 'bob-1'), device('bob', 'bob-2')];
    const events = derive({ added: [a, b] }, [device('me', 'me-1'), a, b]);
    expect(events.map((event) => event.kind)).toEqual(['joined']);
  });

  it('reports an extra device of a present member as a new sign-in', () => {
    const phone = device('bob', 'bob-2');
    const events = derive({ added: [phone] }, [device('bob', 'bob-1'), phone]);
    expect(events).toMatchObject([{ kind: 'device-added', userId: 'bob', deviceId: 'bob-2' }]);
  });

  it('reports the last device leaving as a leave', () => {
    const events = derive({ removed: [device('bob', 'bob-1')] }, [device('me', 'me-1')]);
    expect(events).toMatchObject([{ kind: 'left', userId: 'bob' }]);
  });

  it('says nothing when a member still has another device', () => {
    expect(derive({ removed: [device('bob', 'bob-2')] }, [device('bob', 'bob-1')])).toEqual([]);
  });

  it('treats a device swap for a present member as a new sign-in, not a leave', () => {
    const fresh = device('bob', 'bob-3');
    const events = derive({ added: [fresh], removed: [device('bob', 'bob-1')] }, [fresh]);
    expect(events.map((event) => event.kind)).toEqual(['device-added']);
  });

  it('never announces this device itself', () => {
    const self = device('me', 'me-1');
    expect(derive({ added: [self] }, [self])).toEqual([]);
  });

  it('says nothing when the tree could not be read', () => {
    expect(derive({ added: [device('bob', 'bob-1')] }, undefined)).toEqual([]);
  });
});
