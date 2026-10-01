import { escapeLikePattern } from './like-pattern';

describe('escapeLikePattern', () => {
  it.each([
    ['50%', '50\\%'],
    ['a_b', 'a\\_b'],
    ['c:\\dir', 'c:\\\\dir'],
    ['plain', 'plain'],
  ])('escapes LIKE wildcards in %s so they match literally', (q, escaped) => {
    expect(escapeLikePattern(q)).toBe(escaped);
  });
});
