import { normalizeText } from './normalize-text';

describe('normalizeText', () => {
  it('returns undefined when the value is absent', () => {
    expect(normalizeText(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(normalizeText('')).toBeUndefined();
  });

  it('returns undefined for a whitespace-only string', () => {
    expect(normalizeText('   \n\t ')).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeText('  spam link  ')).toBe('spam link');
  });

  it('keeps interior whitespace untouched', () => {
    expect(normalizeText('two  words')).toBe('two  words');
  });
});
