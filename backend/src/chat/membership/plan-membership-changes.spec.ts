import { BadRequestException } from '@nestjs/common';
import {
  planMembershipChanges,
  type MembershipRequest,
} from './plan-membership-changes';

type State =
  | 'ACTIVE'
  | 'PENDING'
  | 'JOINING'
  | 'LEAVING'
  | 'DECLINED'
  | 'ARCHIVED'
  | 'BLOCKED';

describe('planMembershipChanges', () => {
  const participant = (userId: string, state: State, role = 'MEMBER') => ({
    userId,
    state,
    role,
  });

  const plan = (params: {
    requests: MembershipRequest[];
    participants?: ReturnType<typeof participant>[];
    mlsActive?: boolean;
    withLeaves?: string[];
    onIllegal?: 'throw' | 'skip';
  }) =>
    planMembershipChanges({
      requests: params.requests,
      participants: params.participants ?? [],
      mlsActive: params.mlsActive ?? true,
      userIdsWithLeaves: new Set(params.withLeaves ?? []),
      onIllegal: params.onIllegal,
    });

  describe('adding', () => {
    it('sends someone entitled to join straight to JOINING when the conversation has an MLS group', () => {
      expect(
        plan({ requests: [{ userId: 'u2', event: 'ADD_DIRECT' }] }),
      ).toEqual([{ userId: 'u2', from: null, to: 'JOINING' }]);
    });

    it('makes them ACTIVE straight away when there is no MLS group yet', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'ADD_DIRECT' }],
          mlsActive: false,
        }),
      ).toEqual([{ userId: 'u2', from: null, to: 'ACTIVE' }]);
    });

    it('asks an invitee to accept first, in either case', () => {
      expect(
        plan({ requests: [{ userId: 'u2', event: 'ADD_INVITE' }] }),
      ).toEqual([{ userId: 'u2', from: null, to: 'PENDING' }]);
    });

    it('records the state it read, so a concurrent change is caught by the conditional write', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'ADD_DIRECT' }],
          participants: [participant('u2', 'DECLINED')],
        }),
      ).toEqual([{ userId: 'u2', from: 'DECLINED', to: 'JOINING' }]);
    });

    it('leaves people who are already members alone', () => {
      expect(
        plan({
          requests: [
            { userId: 'u2', event: 'ADD_DIRECT' },
            { userId: 'u3', event: 'ADD_DIRECT' },
          ],
          participants: [
            participant('u2', 'ACTIVE'),
            participant('u3', 'BLOCKED'),
          ],
        }),
      ).toEqual([]);
    });

    it('cancels a pending removal for a direct add, since the person’s devices are still in the group', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'ADD_DIRECT' }],
          participants: [participant('u2', 'LEAVING')],
          withLeaves: ['u2'],
        }),
      ).toEqual([{ userId: 'u2', from: 'LEAVING', to: 'ACTIVE' }]);
    });

    it('does not let an invite skip the acceptance step for someone still being removed', () => {
      expect(() =>
        plan({
          requests: [{ userId: 'u2', event: 'ADD_INVITE' }],
          participants: [participant('u2', 'LEAVING')],
          withLeaves: ['u2'],
        }),
      ).toThrow('still being removed');
    });
  });

  describe('removing', () => {
    it('moves someone with a device in the group to LEAVING, to wait for the Remove Commit', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'REMOVE' }],
          participants: [participant('u2', 'ACTIVE')],
          withLeaves: ['u2'],
        }),
      ).toEqual([{ userId: 'u2', from: 'ACTIVE', to: 'LEAVING' }]);
    });

    it.each<State>(['ACTIVE', 'ARCHIVED', 'BLOCKED'])(
      'declines a %s member with no device in the group at once - nothing could ever complete a removal, and LEAVING would block every send',
      (state) => {
        expect(
          plan({
            requests: [{ userId: 'u2', event: 'REMOVE' }],
            participants: [participant('u2', state)],
            withLeaves: [],
          }),
        ).toEqual([{ userId: 'u2', from: state, to: 'DECLINED' }]);
      },
    );

    it('moves a pending invitee already holding a device to LEAVING instead of declining outright', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'REMOVE' }],
          participants: [participant('u2', 'PENDING')],
          withLeaves: ['u2'],
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'LEAVING' }]);
    });

    it('declines someone who never had a device in the group', () => {
      expect(
        plan({
          requests: [
            { userId: 'u2', event: 'REMOVE' },
            { userId: 'u3', event: 'REMOVE' },
          ],
          participants: [
            participant('u2', 'PENDING'),
            participant('u3', 'JOINING'),
          ],
        }),
      ).toEqual([
        { userId: 'u2', from: 'PENDING', to: 'DECLINED' },
        { userId: 'u3', from: 'JOINING', to: 'DECLINED' },
      ]);
    });

    it('declines directly when there is no MLS group, as before', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'REMOVE' }],
          participants: [participant('u2', 'ACTIVE')],
          mlsActive: false,
        }),
      ).toEqual([{ userId: 'u2', from: 'ACTIVE', to: 'DECLINED' }]);
    });

    it('skips owners - ownership must be transferred first', () => {
      expect(
        plan({
          requests: [{ userId: 'u1', event: 'REMOVE' }],
          participants: [participant('u1', 'ACTIVE', 'OWNER')],
          withLeaves: ['u1'],
        }),
      ).toEqual([]);
    });

    it('is a no-op for someone already leaving, already gone, or not in the conversation', () => {
      expect(
        plan({
          requests: [
            { userId: 'u2', event: 'REMOVE' },
            { userId: 'u3', event: 'REMOVE' },
            { userId: 'u4', event: 'REMOVE' },
          ],
          participants: [
            participant('u2', 'LEAVING'),
            participant('u3', 'DECLINED'),
          ],
          withLeaves: ['u2'],
        }),
      ).toEqual([]);
    });
  });

  describe('accepting and declining an invite', () => {
    it('moves a pending invitee to JOINING when the conversation has an MLS group', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'ACCEPT_INVITE' }],
          participants: [participant('u2', 'PENDING')],
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'JOINING' }]);
    });

    it('moves a pending invitee straight to ACTIVE without one', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'ACCEPT_INVITE' }],
          participants: [participant('u2', 'PENDING')],
          mlsActive: false,
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'ACTIVE' }]);
    });

    it('declines a pending invitee', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'DECLINE_INVITE' }],
          participants: [participant('u2', 'PENDING')],
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'DECLINED' }]);
    });

    it('sends a decline to LEAVING when the invitee already has a device in the group', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'DECLINE_INVITE' }],
          participants: [participant('u2', 'PENDING')],
          withLeaves: ['u2'],
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'LEAVING' }]);
    });

    it('accepts straight into ACTIVE when the invitee already has a device in the group', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'ACCEPT_INVITE' }],
          participants: [participant('u2', 'PENDING')],
          withLeaves: ['u2'],
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'ACTIVE' }]);
    });

    it('expires a pending invitee that nobody ever answered', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'EXPIRE_INVITE' }],
          participants: [participant('u2', 'PENDING')],
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'DECLINED' }]);
    });

    it('sends an expiry to LEAVING when the invitee already has a device in the group', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'EXPIRE_INVITE' }],
          participants: [participant('u2', 'PENDING')],
          withLeaves: ['u2'],
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'LEAVING' }]);
    });

    it('refuses to expire someone who is no longer pending, instead of removing them outright', () => {
      expect(() =>
        plan({
          requests: [{ userId: 'u2', event: 'EXPIRE_INVITE' }],
          participants: [participant('u2', 'ACTIVE')],
        }),
      ).toThrow('Conversation is not pending');
    });

    it('with onIllegal skip, leaves the person who answered alone and still expires the rest', () => {
      expect(
        plan({
          requests: [
            { userId: 'u2', event: 'EXPIRE_INVITE' },
            { userId: 'u3', event: 'EXPIRE_INVITE' },
          ],
          participants: [
            participant('u2', 'ACTIVE'),
            participant('u3', 'PENDING'),
          ],
          onIllegal: 'skip',
        }),
      ).toEqual([{ userId: 'u3', from: 'PENDING', to: 'DECLINED' }]);
    });

    it('lets a pending invitee who already has a device be upgraded straight to ACTIVE by a direct add', () => {
      expect(
        plan({
          requests: [{ userId: 'u2', event: 'ADD_DIRECT' }],
          participants: [participant('u2', 'PENDING')],
          withLeaves: ['u2'],
        }),
      ).toEqual([{ userId: 'u2', from: 'PENDING', to: 'ACTIVE' }]);
    });

    it.each<State>(['ACTIVE', 'DECLINED', 'JOINING', 'LEAVING'])(
      'rejects accepting or declining from %s with the "not pending" message',
      (state) => {
        for (const event of ['ACCEPT_INVITE', 'DECLINE_INVITE'] as const) {
          expect(() =>
            plan({
              requests: [{ userId: 'u2', event }],
              participants: [participant('u2', state)],
            }),
          ).toThrow(new BadRequestException('Conversation is not pending'));
        }
      },
    );

    it('rejects when the user has no participant row at all', () => {
      expect(() =>
        plan({ requests: [{ userId: 'u2', event: 'ACCEPT_INVITE' }] }),
      ).toThrow(BadRequestException);
    });
  });
});
