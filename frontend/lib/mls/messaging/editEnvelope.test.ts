import { describe, expect, it } from 'vitest';
import { buildEditEnvelope, isEditEnvelope, MAX_EDIT_TEXT_CHARS } from './editEnvelope';

const valid = { v: 1, type: 'edit', body: { targetMessageId: 'm1', text: 'new text', n: 1 } };

describe('edit envelope', () => {
  it('builds an envelope that passes its own check', () => {
    expect(isEditEnvelope(buildEditEnvelope({ targetMessageId: 'm1', text: 'hi', n: 3 }))).toBe(true);
  });

  it('accepts a well-formed edit', () => {
    expect(isEditEnvelope(valid)).toBe(true);
  });

  it.each([
    ['null', null],
    ['not an object', 'edit'],
    ['the wrong version', { ...valid, v: 2 }],
    ['the wrong type', { ...valid, type: 'text' }],
    ['no body', { v: 1, type: 'edit' }],
    ['a body that is not an object', { ...valid, body: 'text' }],
    ['no target', { ...valid, body: { text: 'x', n: 1 } }],
    ['an empty target', { ...valid, body: { targetMessageId: '', text: 'x', n: 1 } }],
    ['a target that is too long', { ...valid, body: { targetMessageId: 'x'.repeat(121), text: 'x', n: 1 } }],
    ['empty text', { ...valid, body: { targetMessageId: 'm1', text: '', n: 1 } }],
    ['blank text', { ...valid, body: { targetMessageId: 'm1', text: '   ', n: 1 } }],
    ['text that is not a string', { ...valid, body: { targetMessageId: 'm1', text: 5, n: 1 } }],
    ['text that is too long', { ...valid, body: { targetMessageId: 'm1', text: 'x'.repeat(MAX_EDIT_TEXT_CHARS + 1), n: 1 } }],
    ['an edit number of 0', { ...valid, body: { targetMessageId: 'm1', text: 'x', n: 0 } }],
    ['an edit number past the limit', { ...valid, body: { targetMessageId: 'm1', text: 'x', n: 11 } }],
    ['a fractional edit number', { ...valid, body: { targetMessageId: 'm1', text: 'x', n: 1.5 } }],
  ])('rejects %s', (_name, value) => {
    expect(isEditEnvelope(value)).toBe(false);
  });

  it('accepts text at exactly the limit', () => {
    const body = { targetMessageId: 'm1', text: 'x'.repeat(MAX_EDIT_TEXT_CHARS), n: 10 };
    expect(isEditEnvelope({ ...valid, body })).toBe(true);
  });
});
