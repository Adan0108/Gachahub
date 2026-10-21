import { cleanMessageContent } from './clean-message-content';

const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const WORD_JOINER = String.fromCodePoint(0x2060);
const RTL_OVERRIDE = String.fromCodePoint(0x202e);
const DIRECTION_ISOLATE = String.fromCodePoint(0x2066);
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const NUL = String.fromCodePoint(0);
const BELL = String.fromCodePoint(7);
const ZWJ = String.fromCodePoint(0x200d);

describe('cleanMessageContent', () => {
  it('leaves ordinary text alone', () => {
    expect(cleanMessageContent('Anyone running the banner tonight?')).toBe(
      'Anyone running the banner tonight?',
    );
  });

  it('trims the ends', () => {
    expect(cleanMessageContent('  hello \n ')).toBe('hello');
  });

  it('turns Windows and old Mac line breaks into plain ones', () => {
    expect(cleanMessageContent('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('removes NUL and other control characters, which the database refuses', () => {
    expect(cleanMessageContent(`a${NUL}b${BELL}c`)).toBe('abc');
  });

  it('keeps tabs and line breaks', () => {
    expect(cleanMessageContent('a\tb\nc')).toBe('a\tb\nc');
  });

  it.each([
    ['a zero-width space', ZERO_WIDTH_SPACE],
    ['a right-to-left override', RTL_OVERRIDE],
    ['a direction isolate', DIRECTION_ISOLATE],
    ['a byte order mark', BYTE_ORDER_MARK],
    ['a word joiner', WORD_JOINER],
  ])(
    'removes %s, which can make text look like something else',
    (_name, hidden) => {
      expect(cleanMessageContent(`a${hidden}b`)).toBe('ab');
    },
  );

  it('keeps the joiner inside emoji sequences', () => {
    const family = [0x1f468, 0x1f469, 0x1f467]
      .map((codePoint) => String.fromCodePoint(codePoint))
      .join(ZWJ);

    expect(cleanMessageContent(family)).toBe(family);
  });

  it('squeezes a long run of blank lines to two', () => {
    expect(cleanMessageContent('a\n\n\n\n\n\nb')).toBe('a\n\n\nb');
  });

  it('is empty for text that was only hidden characters', () => {
    expect(cleanMessageContent(` ${ZERO_WIDTH_SPACE}${NUL} \n`)).toBe('');
  });
});
