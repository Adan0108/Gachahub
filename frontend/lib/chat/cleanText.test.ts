import { describe, expect, it } from 'vitest';
import { cleanText } from './cleanText';

// Built from code points so the invisible characters are visible in this file.
const char = (codePoint: number) => String.fromCodePoint(codePoint);
const RLO = char(0x202e); // right-to-left override
const PDF = char(0x202c); // pop directional formatting
const ZWSP = char(0x200b); // zero-width space
const BOM = char(0xfeff); // zero-width no-break space

describe('cleanText', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanText('  hello \n\t  world  ', 50)).toBe('hello world');
  });

  it.each([[undefined], [null], [42], [{}], [['text']], [true]])('has nothing for %p, which is not text', (value) => {
    expect(cleanText(value, 50)).toBeUndefined();
  });

  it('has nothing for a blank value', () => {
    expect(cleanText('', 50)).toBeUndefined();
    expect(cleanText(' \n\t ', 50)).toBeUndefined();
    expect(cleanText(`${ZWSP}${BOM}`, 50)).toBeUndefined();
  });

  it('removes control characters', () => {
    expect(cleanText(`a${char(0)}b${char(7)}c${char(0x7f)}d${char(0x9f)}e`, 50)).toBe('abcde');
  });

  it('removes direction overrides that make a title read backwards', () => {
    expect(cleanText(`moc.lapyap${RLO}test${PDF}`, 50)).toBe('moc.lapyaptest');
  });

  it('removes zero-width characters used to disguise words', () => {
    expect(cleanText(`pay${ZWSP}pal${BOM}`, 50)).toBe('paypal');
  });

  it('keeps ordinary non-latin text and emoji', () => {
    expect(cleanText('Xin chào 世界 🎮', 50)).toBe('Xin chào 世界 🎮');
  });

  it('cuts a long value to the limit with an ellipsis', () => {
    const result = cleanText('x'.repeat(100), 10);

    expect(result).toBe(`${'x'.repeat(9)}…`);
    expect(result).toHaveLength(10);
  });

  it('leaves a value exactly at the limit alone', () => {
    expect(cleanText('x'.repeat(10), 10)).toBe('x'.repeat(10));
  });
});
