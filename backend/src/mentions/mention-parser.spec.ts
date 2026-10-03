import { extractMentionHandles } from './mention-parser';

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

  it('dedupes case-insensitively and caps the count', () => {
    expect(extractMentionHandles('@Bob @bob @BOB')).toEqual(['Bob']);

    const many = Array.from({ length: 15 }, (_, i) => `@user${100 + i}`).join(
      ' ',
    );
    expect(extractMentionHandles(many)).toHaveLength(10);
  });
});
