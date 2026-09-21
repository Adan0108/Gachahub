import type { ChatParticipantState } from '../../generated/prisma/client';
import { isEntitledToLeaf, isLeafRemovable } from './leaf-entitlement';

describe('isEntitledToLeaf', () => {
  it.each<ChatParticipantState>(['JOINING', 'ACTIVE', 'ARCHIVED', 'BLOCKED'])(
    'is true for %s',
    (state) => {
      expect(isEntitledToLeaf(state)).toBe(true);
    },
  );

  it.each<ChatParticipantState | undefined>([
    'PENDING',
    'DECLINED',
    'LEAVING',
    undefined,
  ])('is false for %s', (state) => {
    expect(isEntitledToLeaf(state)).toBe(false);
  });
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

  it.each<ChatParticipantState | undefined>([
    'LEAVING',
    'DECLINED',
    'PENDING',
    undefined,
  ])('removes a device whose owner is %s', (ownerState) => {
    expect(isLeafRemovable({ ownerState, deviceIsGone: false })).toBe(true);
  });
});
