import {
  resolveMembershipTransition,
  type MembershipEvent,
  type MembershipFrom,
} from './membership-state-machine';

const change = (to: string) => ({ kind: 'change', to });
const noop = { kind: 'noop' };
const illegal = { kind: 'illegal' };

describe('resolveMembershipTransition', () => {
  const resolve = (
    from: MembershipFrom,
    event: MembershipEvent,
    mlsActive = true,
  ) => resolveMembershipTransition({ from, event, mlsActive });

  describe('with an MLS group', () => {
    it.each<[MembershipFrom, MembershipEvent, unknown]>([
      // adds that need no acceptance
      ['NONE', 'ADD_DIRECT', change('JOINING')],
      ['DECLINED', 'ADD_DIRECT', change('JOINING')],
      ['PENDING', 'ADD_DIRECT', change('JOINING')],
      ['LEAVING', 'ADD_DIRECT', change('ACTIVE')],
      ['JOINING', 'ADD_DIRECT', noop],
      ['ACTIVE', 'ADD_DIRECT', noop],
      ['ARCHIVED', 'ADD_DIRECT', noop],
      ['BLOCKED', 'ADD_DIRECT', noop],
      // adds that need acceptance
      ['NONE', 'ADD_INVITE', change('PENDING')],
      ['DECLINED', 'ADD_INVITE', change('PENDING')],
      ['PENDING', 'ADD_INVITE', noop],
      ['LEAVING', 'ADD_INVITE', change('ACTIVE')],
      ['JOINING', 'ADD_INVITE', noop],
      ['ACTIVE', 'ADD_INVITE', noop],
      // invites
      ['PENDING', 'ACCEPT_INVITE', change('JOINING')],
      ['ACTIVE', 'ACCEPT_INVITE', illegal],
      ['DECLINED', 'ACCEPT_INVITE', illegal],
      ['NONE', 'ACCEPT_INVITE', illegal],
      ['PENDING', 'DECLINE_INVITE', change('DECLINED')],
      ['ACTIVE', 'DECLINE_INVITE', illegal],
      ['JOINING', 'DECLINE_INVITE', illegal],
      // removal: only someone holding a leaf goes through LEAVING
      ['PENDING', 'REMOVE', change('DECLINED')],
      ['JOINING', 'REMOVE', change('DECLINED')],
      ['ACTIVE', 'REMOVE', change('LEAVING')],
      ['ARCHIVED', 'REMOVE', change('LEAVING')],
      ['BLOCKED', 'REMOVE', change('LEAVING')],
      ['LEAVING', 'REMOVE', noop],
      ['DECLINED', 'REMOVE', noop],
      ['NONE', 'REMOVE', noop],
      // the cryptographic half finishing
      ['JOINING', 'COMMIT_ADDED', change('ACTIVE')],
      ['ACTIVE', 'COMMIT_ADDED', noop],
      ['ARCHIVED', 'COMMIT_ADDED', noop],
      ['BLOCKED', 'COMMIT_ADDED', noop],
      ['PENDING', 'COMMIT_ADDED', illegal],
      ['DECLINED', 'COMMIT_ADDED', illegal],
      ['LEAVING', 'COMMIT_ADDED', illegal],
      ['NONE', 'COMMIT_ADDED', illegal],
      ['LEAVING', 'COMMIT_REMOVED', change('DECLINED')],
      ['DECLINED', 'COMMIT_REMOVED', noop],
      ['ACTIVE', 'COMMIT_REMOVED', illegal],
      ['JOINING', 'COMMIT_REMOVED', illegal],
      ['PENDING', 'COMMIT_REMOVED', illegal],
      // the group's first Commit left them without a device
      ['ACTIVE', 'GROUP_ACTIVATED', change('JOINING')],
      ['ARCHIVED', 'GROUP_ACTIVATED', noop],
      ['BLOCKED', 'GROUP_ACTIVATED', noop],
      ['PENDING', 'GROUP_ACTIVATED', noop],
      ['JOINING', 'GROUP_ACTIVATED', noop],
      ['LEAVING', 'GROUP_ACTIVATED', noop],
      ['DECLINED', 'GROUP_ACTIVATED', noop],
    ])('%s + %s', (from, event, expected) => {
      expect(resolve(from, event)).toEqual(expected);
    });
  });

  describe('without an MLS group', () => {
    it.each<[MembershipFrom, MembershipEvent, unknown]>([
      // joining is immediate
      ['NONE', 'ADD_DIRECT', change('ACTIVE')],
      ['DECLINED', 'ADD_DIRECT', change('ACTIVE')],
      ['PENDING', 'ADD_DIRECT', change('ACTIVE')],
      ['ACTIVE', 'ADD_DIRECT', noop],
      ['PENDING', 'ACCEPT_INVITE', change('ACTIVE')],
      ['NONE', 'ADD_INVITE', change('PENDING')],
      // leaving is final
      ['ACTIVE', 'REMOVE', change('DECLINED')],
      ['ARCHIVED', 'REMOVE', change('DECLINED')],
      ['BLOCKED', 'REMOVE', change('DECLINED')],
      ['PENDING', 'REMOVE', change('DECLINED')],
      ['DECLINED', 'REMOVE', noop],
      ['PENDING', 'DECLINE_INVITE', change('DECLINED')],
    ])('%s + %s', (from, event, expected) => {
      expect(resolve(from, event, false)).toEqual(expected);
    });

    it.each<MembershipFrom>([
      'JOINING',
      'ACTIVE',
      'LEAVING',
      'DECLINED',
      'NONE',
    ])(
      'treats every MLS-side event from %s as illegal, since no group exists',
      (from) => {
        expect(resolve(from, 'COMMIT_ADDED', false)).toEqual(illegal);
        expect(resolve(from, 'COMMIT_REMOVED', false)).toEqual(illegal);
        expect(resolve(from, 'GROUP_ACTIVATED', false)).toEqual(illegal);
      },
    );
  });

  it('never leaves someone in a state that holds no leaf while the group thinks they are a member', () => {
    // A REMOVE from a leaf-holding state must not skip the LEAVING step.
    for (const from of ['ACTIVE', 'ARCHIVED', 'BLOCKED'] as const) {
      expect(resolve(from, 'REMOVE')).toEqual(change('LEAVING'));
    }
  });
});
