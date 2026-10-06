import { cleanText } from './clean-text';

// Built from code points so the invisible characters are visible in this file.
const char = (codePoint: number) => String.fromCodePoint(codePoint);
const RLO = char(0x202e); // right-to-left override
const PDF = char(0x202c); // pop directional formatting
const LRI = char(0x2066); // left-to-right isolate
const PDI = char(0x2069); // pop directional isolate
const RLM = char(0x200f); // right-to-left mark
const LRM = char(0x200e); // left-to-right mark
const ZWSP = char(0x200b); // zero-width space
const ZWJ = char(0x200d); // zero-width joiner
const BOM = char(0xfeff); // zero-width no-break space
const WORD_JOINER = char(0x2060);

describe('cleanText', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanText('  hello \n\t  world  ', 50)).toBe('hello world');
  });

  it('has nothing for an empty or blank value', () => {
    expect(cleanText(undefined, 50)).toBeUndefined();
    expect(cleanText('', 50)).toBeUndefined();
    expect(cleanText(' \n\t ', 50)).toBeUndefined();
  });

  it('removes control characters', () => {
    const controls = [0x00, 0x07, 0x7f, 0x9f].map(char);

    expect(
      cleanText(
        `a${controls[0]}b${controls[1]}c${controls[2]}d${controls[3]}e`,
        50,
      ),
    ).toBe('abcde');
  });

  it('removes bidirectional overrides that make text read backwards', () => {
    expect(cleanText(`moc.lapyap${RLO}test${PDF}`, 50)).toBe('moc.lapyaptest');
    expect(cleanText(`${LRI}isolated${PDI} ${RLM}mark${LRM}`, 50)).toBe(
      'isolated mark',
    );
  });

  it('removes zero-width characters used to disguise words', () => {
    expect(cleanText(`pay${ZWSP}pal${ZWJ}${BOM}${WORD_JOINER}`, 50)).toBe(
      'paypal',
    );
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
