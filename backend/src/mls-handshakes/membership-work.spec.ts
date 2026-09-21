import { buildMembershipWork, type DirtyConversation } from './membership-work';

const conversation = (
  overrides: Partial<DirtyConversation> = {},
): DirtyConversation => ({
  id: 'conv-1',
  mlsEpoch: 4,
  participants: [],
  activeLeaves: [{ userId: 'me', deviceId: 'my-device' }],
  ...overrides,
});

describe('buildMembershipWork', () => {
  it('lists the devices of someone waiting to join', () => {
    const work = buildMembershipWork({
      conversations: [
        conversation({ participants: [{ userId: 'u2', state: 'JOINING' }] }),
      ],
      devicesOfJoiningUsers: [
        { userId: 'u2', deviceId: 'd2a' },
        { userId: 'u2', deviceId: 'd2b' },
      ],
    });

    expect(work).toEqual([
      {
        conversationId: 'conv-1',
        epoch: 4,
        add: [
          { userId: 'u2', deviceId: 'd2a' },
          { userId: 'u2', deviceId: 'd2b' },
        ],
        remove: [],
        unreachableUserIds: [],
      },
    ]);
  });

  it('lists every device in the group of someone being removed', () => {
    const work = buildMembershipWork({
      conversations: [
        conversation({
          participants: [{ userId: 'u3', state: 'LEAVING' }],
          activeLeaves: [
            { userId: 'me', deviceId: 'my-device' },
            { userId: 'u3', deviceId: 'd3a' },
            { userId: 'u3', deviceId: 'd3b' },
          ],
        }),
      ],
      devicesOfJoiningUsers: [],
    });

    expect(work[0]?.remove).toEqual([
      { userId: 'u3', deviceId: 'd3a' },
      { userId: 'u3', deviceId: 'd3b' },
    ]);
    expect(work[0]?.add).toEqual([]);
  });

  it('removes a leaving user’s devices even if the device rows are gone', () => {
    // devicesOfJoiningUsers has nothing for u3 - the leaf list alone drives removal
    const work = buildMembershipWork({
      conversations: [
        conversation({
          participants: [{ userId: 'u3', state: 'LEAVING' }],
          activeLeaves: [{ userId: 'u3', deviceId: 'deleted-device' }],
        }),
      ],
      devicesOfJoiningUsers: [],
    });

    expect(work[0]?.remove).toEqual([
      { userId: 'u3', deviceId: 'deleted-device' },
    ]);
  });

  it('combines an add and a removal into one item', () => {
    const work = buildMembershipWork({
      conversations: [
        conversation({
          participants: [
            { userId: 'u2', state: 'JOINING' },
            { userId: 'u3', state: 'LEAVING' },
          ],
          activeLeaves: [
            { userId: 'me', deviceId: 'my-device' },
            { userId: 'u3', deviceId: 'd3' },
          ],
        }),
      ],
      devicesOfJoiningUsers: [{ userId: 'u2', deviceId: 'd2' }],
    });

    expect(work).toHaveLength(1);
    expect(work[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2' }]);
    expect(work[0]?.remove).toEqual([{ userId: 'u3', deviceId: 'd3' }]);
  });

  it('never proposes a device that is already in the group', () => {
    const work = buildMembershipWork({
      conversations: [
        conversation({
          participants: [{ userId: 'u2', state: 'JOINING' }],
          activeLeaves: [
            { userId: 'me', deviceId: 'my-device' },
            { userId: 'u2', deviceId: 'd2a' },
          ],
        }),
      ],
      devicesOfJoiningUsers: [
        { userId: 'u2', deviceId: 'd2a' },
        { userId: 'u2', deviceId: 'd2b' },
      ],
    });

    expect(work[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2b' }]);
  });

  it('reports a joining user with no usable device, but only next to work the caller can do', () => {
    const work = buildMembershipWork({
      conversations: [
        conversation({
          participants: [
            { userId: 'u2', state: 'JOINING' },
            { userId: 'u3', state: 'JOINING' },
          ],
        }),
      ],
      devicesOfJoiningUsers: [{ userId: 'u2', deviceId: 'd2' }],
    });

    expect(work[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2' }]);
    expect(work[0]?.unreachableUserIds).toEqual(['u3']);
  });

  it('leaves out a conversation with nothing the device can act on', () => {
    const work = buildMembershipWork({
      conversations: [
        conversation({ participants: [{ userId: 'u2', state: 'JOINING' }] }),
      ],
      devicesOfJoiningUsers: [],
    });

    expect(work).toEqual([]);
  });

  it('keeps each conversation’s work separate, with its own epoch', () => {
    const work = buildMembershipWork({
      conversations: [
        conversation({
          id: 'conv-a',
          mlsEpoch: 1,
          participants: [{ userId: 'u2', state: 'JOINING' }],
        }),
        conversation({
          id: 'conv-b',
          mlsEpoch: 9,
          participants: [{ userId: 'u2', state: 'JOINING' }],
        }),
      ],
      devicesOfJoiningUsers: [{ userId: 'u2', deviceId: 'd2' }],
    });

    expect(work.map((item) => [item.conversationId, item.epoch])).toEqual([
      ['conv-a', 1],
      ['conv-b', 9],
    ]);
  });

  it('returns nothing when no conversation is waiting', () => {
    expect(
      buildMembershipWork({ conversations: [], devicesOfJoiningUsers: [] }),
    ).toEqual([]);
  });
});
