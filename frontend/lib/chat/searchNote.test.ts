import { describe, expect, it } from 'vitest';
import { searchNote } from './searchNote';

const ready = { status: 'ready' as const, indexed: 10, total: 10 };
const note = (overrides: Partial<Parameters<typeof searchNote>[0]> = {}) =>
  searchNote({ typed: 'pizza', submitted: 'pizza', indexSnapshot: ready, resultCount: 3, activePosition: -1, ...overrides });

describe('searchNote', () => {
  it('says nothing before anything has been typed or searched', () => {
    expect(note({ typed: '', submitted: '' })).toBe('');
  });

  it('asks for Enter when the box differs from the shown results', () => {
    expect(note({ typed: 'tacos' })).toBe('Press Enter to search.');
  });

  it('asks for more letters when what is typed is too short', () => {
    expect(note({ typed: 'p' })).toBe('Type at least 2 letters, then press Enter.');
    expect(note({ typed: 'p', submitted: 'p' })).toBe('Type at least 2 letters.');
  });

  it('shows how far indexing has got while the index is filling', () => {
    expect(note({ indexSnapshot: { status: 'indexing', indexed: 25, total: 100 } })).toBe(
      'Indexing messages on this device (25%)...',
    );
  });

  it('says when nothing matches', () => {
    expect(note({ resultCount: 0 })).toBe('No messages match.');
  });

  it('counts the results, and where you are among them', () => {
    expect(note()).toBe('3 results');
    expect(note({ resultCount: 1 })).toBe('1 result');
    expect(note({ activePosition: 1 })).toBe('2 of 3 results');
  });
});
