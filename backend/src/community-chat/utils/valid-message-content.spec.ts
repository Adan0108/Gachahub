import { BadRequestException } from '@nestjs/common';
import { validMessageContent } from './valid-message-content';

const ZWSP = String.fromCodePoint(0x200b);

describe('validMessageContent', () => {
  it('returns the cleaned text', () => {
    expect(validMessageContent(`  hi${ZWSP} there  `)).toBe('hi there');
  });

  it.each([
    ['nothing', ''],
    ['spaces', '   '],
    ['only hidden characters', ` ${ZWSP}${ZWSP} `],
  ])('refuses %s', (_name, raw) => {
    expect(() => validMessageContent(raw)).toThrow(BadRequestException);
    expect(() => validMessageContent(raw)).toThrow(/cannot be empty/);
  });

  it('allows exactly 2000 characters and refuses 2001', () => {
    expect(validMessageContent('x'.repeat(2000))).toHaveLength(2000);
    expect(() => validMessageContent('x'.repeat(2001))).toThrow(/too long/);
  });

  it('counts an emoji as one character, not two', () => {
    expect(() => validMessageContent('😀'.repeat(2000))).not.toThrow();
    expect(() => validMessageContent('😀'.repeat(2001))).toThrow(/too long/);
  });
});
