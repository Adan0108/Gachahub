import { describe, expect, it } from 'vitest';
import { groupReactions, withOptimisticReaction } from './chatReactions';

describe('groupReactions', () => {
  it('counts each emoji once per reactor', () => {
    const groups = groupReactions(
      [
        { userId: 'a', emoji: '👍' },
        { userId: 'b', emoji: '👍' },
        { userId: 'c', emoji: '❤️' },
      ],
      'z',
    );
    expect(groups).toEqual([
      { emoji: '👍', count: 2, mine: false },
      { emoji: '❤️', count: 1, mine: false },
    ]);
  });

  it('flags the current user\'s own reaction and sorts it first', () => {
    const groups = groupReactions(
      [
        { userId: 'a', emoji: '👍' },
        { userId: 'me', emoji: '❤️' },
      ],
      'me',
    );
    expect(groups).toEqual([
      { emoji: '❤️', count: 1, mine: true },
      { emoji: '👍', count: 0 + 1, mine: false },
    ]);
  });

  it('ignores custom-emote reactions (no emoji) and empty input', () => {
    expect(groupReactions([{ userId: 'a', emoji: null }], 'me')).toEqual([]);
    expect(groupReactions(undefined, 'me')).toEqual([]);
  });
});

describe('withOptimisticReaction', () => {
  const messages = [
    { id: 'm1', reactions: [{ userId: 'bob', emoji: '👍' }] },
    { id: 'm2', reactions: [] },
  ];

  it('adds the reaction to the right message, leaving others untouched', () => {
    const result = withOptimisticReaction(messages, 'm1', 'me', '❤️');
    expect(result[0]!.reactions).toEqual([
      { userId: 'bob', emoji: '👍' },
      { userId: 'me', emoji: '❤️' },
    ]);
    expect(result[1]).toBe(messages[1]);
  });

  it('replaces an existing reaction from the same user instead of adding a second one', () => {
    const withMine = withOptimisticReaction(messages, 'm1', 'me', '👍');
    const result = withOptimisticReaction(withMine, 'm1', 'me', '😮');
    expect(result[0]!.reactions).toEqual([
      { userId: 'bob', emoji: '👍' },
      { userId: 'me', emoji: '😮' },
    ]);
  });

  it('removes the reaction when emoji is null', () => {
    const withMine = withOptimisticReaction(messages, 'm1', 'me', '❤️');
    const result = withOptimisticReaction(withMine, 'm1', 'me', null);
    expect(result[0]!.reactions).toEqual([{ userId: 'bob', emoji: '👍' }]);
  });

  it('leaves a message with no matching id untouched', () => {
    expect(withOptimisticReaction(messages, 'missing', 'me', '👍')).toEqual(messages);
  });
});
