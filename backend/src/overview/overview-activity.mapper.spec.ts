import {
  formatActivityEntries,
  type AuditLogEntryForActivity,
} from './overview-activity.mapper';

/**
 * The real type is inferred from AuditLogQueryService's return shape (gameId,
 * actorId, actor, ... included) - these tests only care about the fields the
 * mapper actually reads, so a partial object cast stands in for a full row.
 */
function entry(overrides: Partial<AuditLogEntryForActivity>) {
  return {
    id: 'log-1',
    actorName: 'Mod One',
    action: 'POST_HIDDEN',
    targetType: 'POST',
    targetId: 'post-1',
    metadata: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  } as AuditLogEntryForActivity;
}

describe('formatActivityEntries', () => {
  const baseEntry = entry({});

  it('passes through id, action, actor, and timing unchanged', () => {
    const [result] = formatActivityEntries([baseEntry], new Map());

    expect(result).toMatchObject({
      id: 'log-1',
      action: 'POST_HIDDEN',
      actorName: 'Mod One',
      targetType: 'POST',
      targetId: 'post-1',
      occurredAt: baseEntry.createdAt,
    });
  });

  it('falls back to "Deleted user" when the actor snapshot is missing', () => {
    const [result] = formatActivityEntries(
      [{ ...baseEntry, actorName: null }],
      new Map(),
    );

    expect(result.actorName).toBe('Deleted user');
  });

  it('resolves a post title from metadata', () => {
    const [result] = formatActivityEntries(
      [
        {
          ...baseEntry,
          metadata: { authorId: 'author-1', postTitle: 'Version guide' },
        },
      ],
      new Map(),
    );

    expect(result.targetName).toBe('Version guide');
  });

  it('returns null for a post entry with no title in metadata', () => {
    const [result] = formatActivityEntries([baseEntry], new Map());

    expect(result.targetName).toBeNull();
  });

  it('resolves a comment entry to its parent post id', () => {
    const [result] = formatActivityEntries(
      [
        {
          ...baseEntry,
          targetType: 'COMMENT',
          metadata: { authorId: 'author-1', postId: 'post-5' },
        },
      ],
      new Map(),
    );

    expect(result.targetName).toBe('post-5');
  });

  it('resolves a report entry to its own target type and id', () => {
    const [result] = formatActivityEntries(
      [
        {
          ...baseEntry,
          targetType: 'REPORT',
          metadata: { reportedTargetType: 'POST', reportedTargetId: 'post-9' },
        },
      ],
      new Map(),
    );

    expect(result.targetName).toBe('POST post-9');
  });

  it('returns null for a report entry with no reportedTargetId', () => {
    const [result] = formatActivityEntries(
      [{ ...baseEntry, targetType: 'REPORT', metadata: null }],
      new Map(),
    );

    expect(result.targetName).toBeNull();
  });

  it('resolves a USER entry to the name from the provided lookup map', () => {
    const [result] = formatActivityEntries(
      [{ ...baseEntry, targetType: 'USER', targetId: 'user-1' }],
      new Map([['user-1', 'Rover']]),
    );

    expect(result.targetName).toBe('Rover');
  });

  it('returns null for a USER entry missing from the lookup map', () => {
    const [result] = formatActivityEntries(
      [{ ...baseEntry, targetType: 'USER', targetId: 'user-2' }],
      new Map([['user-1', 'Rover']]),
    );

    expect(result.targetName).toBeNull();
  });
});
