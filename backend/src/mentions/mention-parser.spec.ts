import { extractMentionHandles, MAX_MENTIONS_PER_TEXT } from './mention-parser';

describe('extractMentionHandles', () => {
  it('finds handles anywhere in the text', () => {
    expect(extractMentionHandles('hey @bob and @Alice-1, look')).toEqual([
      'bob',
      'Alice-1',
    ]);
  });

  it('ignores emails and invalid handles', () => {
    expect(extractMentionHandles('mail bob@gmail.com or @ab or @-bob')).toEqual(
      [],
    );
  });

  it('drops trailing separators from the handle', () => {
    expect(extractMentionHandles('thanks @bob_ and @amy-.')).toEqual([
      'bob',
      'amy',
    ]);
  });

  it('treats a hyphenated handle as one whole handle, never a shorter prefix', () => {
    expect(extractMentionHandles('hi @bob-smith')).toEqual(['bob-smith']);
  });

  it('mentions nobody for an invalid run, rather than falling back to a prefix', () => {
    expect(extractMentionHandles('hi @bob--x')).toEqual([]);
  });

  it('dedupes case-insensitively and caps the count', () => {
    expect(extractMentionHandles('@Bob @bob @BOB')).toEqual(['Bob']);

    const many = Array.from({ length: 15 }, (_, i) => `@user${100 + i}`).join(
      ' ',
    );
    expect(extractMentionHandles(many)).toHaveLength(10);
  });
});

describe('extractMentionHandles with a custom limit', () => {
  const many = Array.from({ length: 15 }, (_, i) => `@user${i}`).join(' ');

  it('stops at the limit it is given', () => {
    expect(extractMentionHandles(many, 3)).toEqual(['user0', 'user1', 'user2']);
  });

  it('lets a caller look one past the allowed number to see there were too many', () => {
    expect(extractMentionHandles(many, MAX_MENTIONS_PER_TEXT + 1)).toHaveLength(
      MAX_MENTIONS_PER_TEXT + 1,
    );
  });
});
