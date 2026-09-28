import type { ChatParticipantState } from '../../generated/prisma/client';
import {
  isEntitledToLeaf,
  isLeafRemovable,
  isMemberState,
} from './leaf-entitlement';

describe('isEntitledToLeaf', () => {
  it.each<ChatParticipantState>([
    'PENDING',
    'JOINING',
    'ACTIVE',
    'ARCHIVED',
    'BLOCKED',
  ])('is true for %s', (state) => {
    expect(isEntitledToLeaf(state)).toBe(true);
  });

  it.each<ChatParticipantState | undefined>(['DECLINED', 'LEAVING', undefined])(
    'is false for %s',
    (state) => {
      expect(isEntitledToLeaf(state)).toBe(false);
    },
  );
});

describe('isLeafRemovable', () => {
  it('keeps a working device of someone entitled to stay', () => {
    expect(isLeafRemovable({ ownerState: 'ACTIVE', deviceIsGone: false })).toBe(
      false,
    );
  });

  it('removes a revoked or deleted device even when its owner stays', () => {
    expect(isLeafRemovable({ ownerState: 'ACTIVE', deviceIsGone: true })).toBe(
      true,
    );
  });

  it.each<ChatParticipantState | undefined>(['LEAVING', 'DECLINED', undefined])(
    'removes a device whose owner is %s',
    (ownerState) => {
      expect(isLeafRemovable({ ownerState, deviceIsGone: false })).toBe(true);
    },
  );

  it('keeps a device of a PENDING owner - they are entitled to a leaf too', () => {
    expect(
      isLeafRemovable({ ownerState: 'PENDING', deviceIsGone: false }),
    ).toBe(false);
  });
});

describe('isMemberState', () => {
  it.each<ChatParticipantState>(['ACTIVE', 'ARCHIVED', 'BLOCKED'])(
    'is true for %s',
    (state) => {
      expect(isMemberState(state)).toBe(true);
    },
  );

  it.each<ChatParticipantState | undefined>([
    'PENDING',
    'JOINING',
    'LEAVING',
    'DECLINED',
    undefined,
  ])('is false for %s', (state) => {
    expect(isMemberState(state)).toBe(false);
  });
});
