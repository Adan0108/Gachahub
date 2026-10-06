import { describe, expect, it } from 'vitest';
import { buildSnippet, highlightRanges } from './searchSnippet';

const marked = (text: string, ranges: { start: number; end: number }[]) =>
  ranges.map((range) => text.slice(range.start, range.end));

describe('highlightRanges', () => {
  it('marks every occurrence in the original text', () => {
    const text = 'Ok ok OK';
    expect(marked(text, highlightRanges(text, ['ok']))).toEqual(['Ok', 'ok', 'OK']);
  });

  it('marks the original letters when only the folded form matches', () => {
    const text = 'Meet at the Café';
    expect(marked(text, highlightRanges(text, ['cafe']))).toEqual(['Café']);
  });

  it('keeps a separate accent mark inside the highlight', () => {
    const text = 'Café time';
    expect(marked(text, highlightRanges(text, ['cafe']))).toEqual(['Café']);
  });

  it('marks a stroke letter by what was typed without the stroke', () => {
    const text = 'Gọi điện nhé';
    expect(marked(text, highlightRanges(text, ['dien']))).toEqual(['điện']);
  });

  it('merges overlapping and touching matches', () => {
    const text = 'foobar';
    expect(highlightRanges(text, ['foo', 'oba', 'bar'])).toEqual([{ start: 0, end: 6 }]);
  });

  it('matches around emoji without splitting them', () => {
    const text = '😀 party 😀';
    expect(marked(text, highlightRanges(text, ['party']))).toEqual(['party']);
  });

  it('finds nothing for a term that is not there', () => {
    expect(highlightRanges('hello', ['xyz'])).toEqual([]);
  });
});

describe('buildSnippet', () => {
  it('returns a short message whole, with the match marked', () => {
    const snippet = buildSnippet('Ok :> see you', ['see']);

    expect(snippet.text).toBe('Ok :> see you');
    expect(marked(snippet.text, snippet.highlights)).toEqual(['see']);
  });

  it('collapses line breaks and extra spaces', () => {
    const snippet = buildSnippet('first\n\n  second   line', ['second']);

    expect(snippet.text).toBe('first second line');
    expect(marked(snippet.text, snippet.highlights)).toEqual(['second']);
  });

  it('cuts a long message around the first match with ellipses', () => {
    const text = `${'a '.repeat(60)}needle${' b'.repeat(60)}`;
    const snippet = buildSnippet(text, ['needle'], 10);

    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(snippet.text.length).toBeLessThan(40);
    expect(marked(snippet.text, snippet.highlights)).toEqual(['needle']);
  });

  it('has no leading ellipsis when the match is at the start', () => {
    const snippet = buildSnippet(`needle ${'x'.repeat(200)}`, ['needle'], 10);

    expect(snippet.text.startsWith('needle')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
  });

  it('marks later matches that fall inside the window', () => {
    const snippet = buildSnippet('cat and cat and a very long tail '.repeat(10), ['cat'], 12);

    expect(marked(snippet.text, snippet.highlights).every((part) => part === 'cat')).toBe(true);
    expect(snippet.highlights.length).toBeGreaterThan(1);
  });

  it('does not cut an emoji in half at the window edge', () => {
    const text = `${'😀'.repeat(30)}needle${'😀'.repeat(30)}`;

    for (let radius = 1; radius < 8; radius += 1) {
      const snippet = buildSnippet(text, ['needle'], radius);
      expect(snippet.text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
      expect(marked(snippet.text, snippet.highlights)).toEqual(['needle']);
    }
  });

  it('still returns the start of the text when nothing matches', () => {
    const snippet = buildSnippet('hello there', ['zzz']);

    expect(snippet.text).toBe('hello there');
    expect(snippet.highlights).toEqual([]);
  });
});
