import { describe, expect, it } from 'vitest';
import { foldForSearch, matchesAllTerms, parseSearchQuery } from './searchFolding';

describe('foldForSearch', () => {
  it('ignores case and accents', () => {
    expect(foldForSearch('Café ÉCOLE Ñandú')).toBe('cafe ecole nandu');
  });

  it('treats a letter plus a separate accent mark like the precomposed letter', () => {
    expect(foldForSearch('Café')).toBe('cafe');
  });

  it('folds letters whose stroke people do not type', () => {
    expect(foldForSearch('Điện Ørsted Łódź')).toBe('dien orsted lodz');
  });

  it('leaves emoji and other scripts alone', () => {
    expect(foldForSearch('hi 😀 こんにちは')).toBe('hi 😀 こんにちは');
  });
});

describe('parseSearchQuery', () => {
  it('splits into folded, distinct words', () => {
    expect(parseSearchQuery('  Hello   WORLD hello ')).toEqual(['hello', 'world']);
  });

  it('has no terms for a blank query', () => {
    expect(parseSearchQuery('')).toEqual([]);
    expect(parseSearchQuery('   ')).toEqual([]);
  });
});

describe('matchesAllTerms', () => {
  it('needs every word, anywhere in the text', () => {
    expect(matchesAllTerms('see you at the cafe', ['cafe', 'see'])).toBe(true);
    expect(matchesAllTerms('see you at the cafe', ['cafe', 'tea'])).toBe(false);
  });

  it('matches part of a word', () => {
    expect(matchesAllTerms('shell', ['hel'])).toBe(true);
  });

  it('matches nothing when there are no terms', () => {
    expect(matchesAllTerms('anything', [])).toBe(false);
  });
});
