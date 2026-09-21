import {
  buildMembershipWork,
  type ConversationFacts,
  type DeviceRecord,
} from './membership-work';

const ME = { userId: 'me', deviceId: 'my-device' };

const conversation = (
  overrides: Partial<ConversationFacts> = {},
): ConversationFacts => ({
  id: 'conv-1',
  mlsEpoch: 4,
  participants: [{ userId: 'me', state: 'ACTIVE' }],
  activeLeaves: [ME],
  ...overrides,
});

const device = (
  userId: string,
  deviceId: string,
  revoked = false,
): DeviceRecord => ({ userId, deviceId, revoked });

/** The requesting device's own record, which is always present and working. */
const myDevice = device('me', 'my-device');

const work = (
  conversations: ConversationFacts[],
  devices: DeviceRecord[] = [],
) =>
  buildMembershipWork({
    conversations,
    devices: [myDevice, ...devices],
    requestingDeviceId: 'my-device',
  });

describe('buildMembershipWork', () => {
  describe('adds', () => {
    it('lists the devices of someone waiting to join', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u2', state: 'JOINING' },
            ],
          }),
        ],
        [device('u2', 'd2a'), device('u2', 'd2b')],
      );

      expect(result).toEqual([
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

    it('lists a new device of a member who is already in', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u2', state: 'ACTIVE' },
            ],
            activeLeaves: [ME, { userId: 'u2', deviceId: 'd2-old' }],
          }),
        ],
        [device('u2', 'd2-old'), device('u2', 'd2-new')],
      );

      expect(result[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2-new' }]);
    });

    it.each(['ARCHIVED', 'BLOCKED'] as const)(
      'gives a %s member who never got a device one - they are entitled, and would otherwise never read',
      (state) => {
        const result = work(
          [
            conversation({
              participants: [
                { userId: 'me', state: 'ACTIVE' },
                { userId: 'u2', state: state },
              ],
            }),
          ],
          [device('u2', 'd2')],
        );

        expect(result[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2' }]);
      },
    );

    it('gives an ACTIVE member the devices they were missing when they joined', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u2', state: 'ACTIVE' },
            ],
            activeLeaves: [ME, { userId: 'u2', deviceId: 'd2a' }],
          }),
        ],
        [device('u2', 'd2a'), device('u2', 'd2b')],
      );

      expect(result[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2b' }]);
    });

    it.each(['PENDING', 'DECLINED', 'LEAVING'] as const)(
      'never adds a device for someone who is %s',
      (state) => {
        const result = work(
          [
            conversation({
              participants: [
                { userId: 'me', state: 'ACTIVE' },
                { userId: 'u2', state: state },
              ],
            }),
          ],
          [device('u2', 'd2')],
        );

        expect(result).toEqual([]);
      },
    );

    it('never adds a revoked device', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u2', state: 'JOINING' },
            ],
          }),
        ],
        [device('u2', 'd2-lost', true), device('u2', 'd2-ok')],
      );

      expect(result[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2-ok' }]);
    });

    it('never proposes a device that is already in the group', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u2', state: 'JOINING' },
            ],
            activeLeaves: [ME, { userId: 'u2', deviceId: 'd2a' }],
          }),
        ],
        [device('u2', 'd2a'), device('u2', 'd2b')],
      );

      expect(result[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2b' }]);
    });

    it('reports a joining user with no usable device, but only next to work the caller can do', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u2', state: 'JOINING' },
              { userId: 'u3', state: 'JOINING' },
            ],
          }),
        ],
        [device('u2', 'd2')],
      );

      expect(result[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2' }]);
      expect(result[0]?.unreachableUserIds).toEqual(['u3']);
    });
  });

  describe('removals', () => {
    it('lists every device in the group of someone being removed', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u3', state: 'LEAVING' },
            ],
            activeLeaves: [
              ME,
              { userId: 'u3', deviceId: 'd3a' },
              { userId: 'u3', deviceId: 'd3b' },
            ],
          }),
        ],
        [device('u3', 'd3a'), device('u3', 'd3b')],
      );

      expect(result[0]?.remove).toEqual([
        { userId: 'u3', deviceId: 'd3a' },
        { userId: 'u3', deviceId: 'd3b' },
      ]);
      expect(result[0]?.add).toEqual([]);
    });

    it('removes a leaving user’s device even if its row is gone', () => {
      const result = work([
        conversation({
          participants: [
            { userId: 'me', state: 'ACTIVE' },
            { userId: 'u3', state: 'LEAVING' },
          ],
          activeLeaves: [ME, { userId: 'u3', deviceId: 'deleted-device' }],
        }),
      ]);

      expect(result[0]?.remove).toEqual([
        { userId: 'u3', deviceId: 'deleted-device' },
      ]);
    });

    it('removes a revoked device of a member who stays - a lost or stolen device must stop receiving new epochs', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u2', state: 'ACTIVE' },
            ],
            activeLeaves: [
              ME,
              { userId: 'u2', deviceId: 'd2-stolen' },
              { userId: 'u2', deviceId: 'd2-ok' },
            ],
          }),
        ],
        [device('u2', 'd2-stolen', true), device('u2', 'd2-ok')],
      );

      expect(result[0]?.remove).toEqual([
        { userId: 'u2', deviceId: 'd2-stolen' },
      ]);
    });

    it('removes a device of someone who declined but still has a device in the group', () => {
      const result = work(
        [
          conversation({
            participants: [
              { userId: 'me', state: 'ACTIVE' },
              { userId: 'u2', state: 'DECLINED' },
            ],
            activeLeaves: [ME, { userId: 'u2', deviceId: 'd2' }],
          }),
        ],
        [device('u2', 'd2')],
      );

      expect(result[0]?.remove).toEqual([{ userId: 'u2', deviceId: 'd2' }]);
    });

    it('removes a device whose owner is no longer a participant at all', () => {
      const result = work(
        [
          conversation({
            activeLeaves: [ME, { userId: 'ghost', deviceId: 'd-ghost' }],
          }),
        ],
        [device('ghost', 'd-ghost')],
      );

      expect(result[0]?.remove).toEqual([
        { userId: 'ghost', deviceId: 'd-ghost' },
      ]);
    });

    it.each(['ACTIVE', 'ARCHIVED', 'BLOCKED', 'JOINING'] as const)(
      'keeps a working device of a %s member',
      (state) => {
        const result = work(
          [
            conversation({
              participants: [
                { userId: 'me', state: 'ACTIVE' },
                { userId: 'u2', state: state },
              ],
              activeLeaves: [ME, { userId: 'u2', deviceId: 'd2' }],
            }),
          ],
          [device('u2', 'd2')],
        );

        expect(result).toEqual([]);
      },
    );

    it('never asks a device to remove itself', () => {
      const result = buildMembershipWork({
        conversations: [
          conversation({
            // the asking device's own owner is not entitled - it must still not be told to remove itself
            participants: [{ userId: 'me', state: 'LEAVING' }],
          }),
        ],
        devices: [myDevice],
        requestingDeviceId: 'my-device',
      });

      expect(result).toEqual([]);
    });
  });

  it('combines an add and a removal into one item', () => {
    const result = work(
      [
        conversation({
          participants: [
            { userId: 'me', state: 'ACTIVE' },
            { userId: 'u2', state: 'JOINING' },
            { userId: 'u3', state: 'LEAVING' },
          ],
          activeLeaves: [ME, { userId: 'u3', deviceId: 'd3' }],
        }),
      ],
      [device('u2', 'd2'), device('u3', 'd3')],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.add).toEqual([{ userId: 'u2', deviceId: 'd2' }]);
    expect(result[0]?.remove).toEqual([{ userId: 'u3', deviceId: 'd3' }]);
  });

  it('leaves out a conversation with nothing the device can act on', () => {
    const result = work([
      conversation({
        participants: [
          { userId: 'me', state: 'ACTIVE' },
          { userId: 'u2', state: 'JOINING' },
        ],
      }),
    ]);

    expect(result).toEqual([]);
  });

  it('keeps each conversation’s work separate, with its own epoch', () => {
    const joining = [
      { userId: 'me', state: 'ACTIVE' as const },
      { userId: 'u2', state: 'JOINING' as const },
    ];
    const result = work(
      [
        conversation({ id: 'conv-a', mlsEpoch: 1, participants: joining }),
        conversation({ id: 'conv-b', mlsEpoch: 9, participants: joining }),
      ],
      [device('u2', 'd2')],
    );

    expect(result.map((item) => [item.conversationId, item.epoch])).toEqual([
      ['conv-a', 1],
      ['conv-b', 9],
    ]);
  });

  it('returns nothing when no conversation is waiting', () => {
    expect(work([])).toEqual([]);
  });
});
