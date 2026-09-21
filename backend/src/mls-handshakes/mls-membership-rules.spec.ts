import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { ChatParticipantState } from '../generated/prisma/client';
import {
  assertAddedDevicesAuthorized,
  assertDeclarationIsConsistent,
  assertRemovedDevicesRemovable,
  assertSenderIsMember,
  planCommitTransitions,
  type DeviceFact,
} from './mls-membership-rules';

const device = (
  id: string,
  userId: string,
  revokedAt: Date | null = null,
): DeviceFact => ({ id, userId, revokedAt });

const states = (entries: Array<[string, ChatParticipantState]>) =>
  new Map(entries);

describe('assertDeclarationIsConsistent', () => {
  const ok = {
    senderDeviceId: 'sender',
    addedDeviceIds: ['a1', 'a2'],
    removedDeviceIds: ['r1'],
    welcomeRecipientDeviceIds: ['a1', 'a2'],
  };

  it('accepts welcomes that match the added devices exactly', () => {
    expect(() => assertDeclarationIsConsistent(ok)).not.toThrow();
  });

  it('accepts a Commit that changes no one', () => {
    expect(() =>
      assertDeclarationIsConsistent({
        senderDeviceId: 'sender',
        addedDeviceIds: [],
        removedDeviceIds: [],
        welcomeRecipientDeviceIds: [],
      }),
    ).not.toThrow();
  });

  it.each([
    ['a device added twice', { addedDeviceIds: ['a1', 'a1'] }],
    ['a device removed twice', { removedDeviceIds: ['r1', 'r1'] }],
    [
      'a Welcome sent twice to the same device',
      { welcomeRecipientDeviceIds: ['a1', 'a1'] },
    ],
  ])('rejects %s', (_name, override) => {
    expect(() => assertDeclarationIsConsistent({ ...ok, ...override })).toThrow(
      BadRequestException,
    );
  });

  it('rejects an added device that has no Welcome', () => {
    expect(() =>
      assertDeclarationIsConsistent({
        ...ok,
        welcomeRecipientDeviceIds: ['a1'],
      }),
    ).toThrow(/exactly the devices/);
  });

  it('rejects a Welcome for a device the Commit does not add', () => {
    expect(() =>
      assertDeclarationIsConsistent({
        ...ok,
        welcomeRecipientDeviceIds: ['a1', 'a2', 'stranger'],
      }),
    ).toThrow(/exactly the devices/);
  });

  it('rejects a Welcome addressed to a different device than the one declared', () => {
    expect(() =>
      assertDeclarationIsConsistent({
        ...ok,
        welcomeRecipientDeviceIds: ['a1', 'someone-else'],
      }),
    ).toThrow(/exactly the devices/);
  });

  it('rejects adding and removing the same device', () => {
    expect(() =>
      assertDeclarationIsConsistent({
        ...ok,
        removedDeviceIds: ['a1'],
      }),
    ).toThrow(/same device/);
  });

  it('rejects a device adding or removing itself', () => {
    expect(() =>
      assertDeclarationIsConsistent({
        ...ok,
        addedDeviceIds: ['sender'],
        welcomeRecipientDeviceIds: ['sender'],
      }),
    ).toThrow(/itself/);
    expect(() =>
      assertDeclarationIsConsistent({ ...ok, removedDeviceIds: ['sender'] }),
    ).toThrow(/itself/);
  });
});

describe('assertSenderIsMember', () => {
  it('lets a device in the group commit', () => {
    expect(() => assertSenderIsMember(new Set(['d1']), 'd1')).not.toThrow();
  });

  it('refuses a device that is not in the group', () => {
    expect(() => assertSenderIsMember(new Set(['d1']), 'd2')).toThrow(
      ForbiddenException,
    );
  });
});

describe('assertAddedDevicesAuthorized', () => {
  const base = {
    addedDeviceIds: ['d2'],
    deviceById: new Map([['d2', device('d2', 'u2')]]),
    participantStateByUserId: states([['u2', 'JOINING']]),
    activeLeafDeviceIds: new Set<string>(),
  };

  it.each<ChatParticipantState>(['JOINING', 'ACTIVE', 'ARCHIVED', 'BLOCKED'])(
    'allows a device for someone who is %s',
    (state) => {
      expect(() =>
        assertAddedDevicesAuthorized({
          ...base,
          participantStateByUserId: states([['u2', state]]),
        }),
      ).not.toThrow();
    },
  );

  it.each<ChatParticipantState>(['PENDING', 'DECLINED', 'LEAVING'])(
    'refuses a device for someone who is %s',
    (state) => {
      expect(() =>
        assertAddedDevicesAuthorized({
          ...base,
          participantStateByUserId: states([['u2', state]]),
        }),
      ).toThrow(ForbiddenException);
    },
  );

  it('refuses a device for someone who is not a participant at all', () => {
    expect(() =>
      assertAddedDevicesAuthorized({
        ...base,
        participantStateByUserId: states([]),
      }),
    ).toThrow(ForbiddenException);
  });

  it('refuses an unknown device', () => {
    expect(() =>
      assertAddedDevicesAuthorized({ ...base, deviceById: new Map() }),
    ).toThrow(BadRequestException);
  });

  it('refuses a revoked device', () => {
    expect(() =>
      assertAddedDevicesAuthorized({
        ...base,
        deviceById: new Map([['d2', device('d2', 'u2', new Date())]]),
      }),
    ).toThrow(/revoked/);
  });

  it('refuses a device that is already in the group', () => {
    expect(() =>
      assertAddedDevicesAuthorized({
        ...base,
        activeLeafDeviceIds: new Set(['d2']),
      }),
    ).toThrow(ConflictException);
  });
});

describe('assertRemovedDevicesRemovable', () => {
  const base = {
    removedDeviceIds: ['d2'],
    activeLeafUserIdByDeviceId: new Map([['d2', 'u2']]),
    deviceById: new Map([['d2', device('d2', 'u2')]]),
    participantStateByUserId: states([['u2', 'LEAVING']]),
  };

  it.each<ChatParticipantState>(['LEAVING', 'DECLINED', 'PENDING'])(
    'allows removing a device whose owner is %s',
    (state) => {
      expect(() =>
        assertRemovedDevicesRemovable({
          ...base,
          participantStateByUserId: states([['u2', state]]),
        }),
      ).not.toThrow();
    },
  );

  it('allows removing a device whose owner is no longer a participant', () => {
    expect(() =>
      assertRemovedDevicesRemovable({
        ...base,
        participantStateByUserId: states([]),
      }),
    ).not.toThrow();
  });

  it.each<ChatParticipantState>(['ACTIVE', 'ARCHIVED', 'BLOCKED', 'JOINING'])(
    'refuses to remove a working device of someone who is %s - that would evict a legitimate member',
    (state) => {
      expect(() =>
        assertRemovedDevicesRemovable({
          ...base,
          participantStateByUserId: states([['u2', state]]),
        }),
      ).toThrow(ForbiddenException);
    },
  );

  it('allows removing a revoked device of a member who stays', () => {
    expect(() =>
      assertRemovedDevicesRemovable({
        ...base,
        deviceById: new Map([['d2', device('d2', 'u2', new Date())]]),
        participantStateByUserId: states([['u2', 'ACTIVE']]),
      }),
    ).not.toThrow();
  });

  it('allows removing a device whose row was deleted, even for a member who stays', () => {
    expect(() =>
      assertRemovedDevicesRemovable({
        ...base,
        deviceById: new Map(),
        participantStateByUserId: states([['u2', 'ACTIVE']]),
      }),
    ).not.toThrow();
  });

  it('refuses a device that is not in the group', () => {
    expect(() =>
      assertRemovedDevicesRemovable({
        ...base,
        activeLeafUserIdByDeviceId: new Map(),
      }),
    ).toThrow(BadRequestException);
  });
});

describe('planCommitTransitions', () => {
  const plan = (
    overrides: Partial<Parameters<typeof planCommitTransitions>[0]>,
  ) =>
    planCommitTransitions({
      participantStateByUserId: states([]),
      addedUserIds: [],
      fullyRemovedUserIds: [],
      userIdsWithDevices: new Set(),
      groupJustActivated: false,
      ...overrides,
    });

  it('activates someone who was waiting to join', () => {
    expect(
      plan({
        participantStateByUserId: states([['u2', 'JOINING']]),
        addedUserIds: ['u2'],
      }),
    ).toEqual([{ userId: 'u2', from: 'JOINING', to: 'ACTIVE' }]);
  });

  it('changes nothing for a member who just gained another device', () => {
    expect(
      plan({
        participantStateByUserId: states([['u2', 'ACTIVE']]),
        addedUserIds: ['u2'],
      }),
    ).toEqual([]);
  });

  it('finishes removing someone whose last device is gone', () => {
    expect(
      plan({
        participantStateByUserId: states([['u2', 'LEAVING']]),
        fullyRemovedUserIds: ['u2'],
      }),
    ).toEqual([{ userId: 'u2', from: 'LEAVING', to: 'DECLINED' }]);
  });

  it('leaves a member alone who only lost a revoked device', () => {
    expect(
      plan({
        participantStateByUserId: states([['u2', 'ACTIVE']]),
        fullyRemovedUserIds: ['u2'],
      }),
    ).toEqual([]);
  });

  it('does both in one Commit', () => {
    expect(
      plan({
        participantStateByUserId: states([
          ['u2', 'JOINING'],
          ['u3', 'LEAVING'],
        ]),
        addedUserIds: ['u2'],
        fullyRemovedUserIds: ['u3'],
      }),
    ).toEqual([
      { userId: 'u2', from: 'JOINING', to: 'ACTIVE' },
      { userId: 'u3', from: 'LEAVING', to: 'DECLINED' },
    ]);
  });

  describe('when the Commit creates the group', () => {
    it('moves anyone ACTIVE without a device into JOINING, and leaves everyone else alone', () => {
      expect(
        plan({
          groupJustActivated: true,
          participantStateByUserId: states([
            ['founder', 'ACTIVE'],
            ['welcomed', 'ACTIVE'],
            ['missed', 'ACTIVE'],
            ['invited', 'PENDING'],
            ['archived', 'ARCHIVED'],
          ]),
          addedUserIds: ['welcomed'],
          userIdsWithDevices: new Set(['founder', 'welcomed']),
        }),
      ).toEqual([{ userId: 'missed', from: 'ACTIVE', to: 'JOINING' }]);
    });

    it('does nothing to the roster when a later Commit is not the first', () => {
      expect(
        plan({
          groupJustActivated: false,
          participantStateByUserId: states([['missed', 'ACTIVE']]),
          userIdsWithDevices: new Set(),
        }),
      ).toEqual([]);
    });
  });

  it('refuses a change for someone with no participant row, rather than guessing', () => {
    expect(() => plan({ addedUserIds: ['ghost'] })).toThrow(ConflictException);
  });
});
