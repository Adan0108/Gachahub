import { isSingleEmoji } from './is-single-emoji';

const char = (...codePoints: number[]) => String.fromCodePoint(...codePoints);

describe('isSingleEmoji', () => {
  it.each([
    ['a simple emoji', '😀'],
    ['an older symbol emoji', '❤️'],
    ['a symbol without its selector', '❤'],
    ['a thumbs up with a skin tone', '👍🏽'],
    ['a family joined with zero-width joiners', '👨‍👩‍👧‍👦'],
    ['a flag made of two letters', '🇻🇳'],
    ['the rainbow flag', '🏳️‍🌈'],
    ['a keycap', '1️⃣'],
    ['the keycap ten', '🔟'],
    ['an emoji from a recent Unicode version', char(0x1fadb)],
    [
      'a subdivision flag built from tag characters',
      char(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f),
    ],
    ['a person with a profession', '🧑‍🍳'],
    ['a hash keycap', '#️⃣'],
  ])('accepts %s', (_name, value) => {
    expect(isSingleEmoji(value)).toBe(true);
  });

  it.each([
    ['plain text', 'a'],
    ['a word', 'hello'],
    ['a digit', '7'],
    ['a digit with only a selector', '1️'],
    ['an empty string', ''],
    ['only spaces', '   '],
    ['two emoji', '😀😀'],
    ['an emoji with a trailing space', '😀 '],
    ['an emoji with a leading space', ' 😀'],
    ['an emoji and a letter', '😀a'],
    ['a single flag letter', char(0x1f1fb)],
    ['three flag letters', char(0x1f1fb, 0x1f1f3, 0x1f1fb)],
    ['a bare zero-width joiner', '‍'],
    ['an emoji with combining marks stacked on it', '😀́̂̃'],
    ['markup', '<script>'],
    ['an emoji wrapped in markup', '<😀>'],
    ['text in another script', 'あ'],
    ['a long run of joined emoji', `😀${'‍😀'.repeat(20)}`],
  ])('rejects %s', (_name, value) => {
    expect(isSingleEmoji(value)).toBe(false);
  });

  it('rejects anything longer than 32 characters even if it reads as one glyph', () => {
    expect(isSingleEmoji(`😀${'️'.repeat(40)}`)).toBe(false);
  });

  it('copes with a lone surrogate', () => {
    expect(isSingleEmoji('\uD83D')).toBe(false);
  });
});
