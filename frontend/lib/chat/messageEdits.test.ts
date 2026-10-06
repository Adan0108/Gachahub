import { describe, expect, it } from 'vitest';
import { applyEdits, isEditMessage } from './messageEdits';

const T0 = Date.parse('2026-10-05T12:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const original = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  senderId: 'alice',
  createdAt: at(0),
  contentType: 'TEXT',
  status: 'SENT',
  ...extra,
});

const editRow = (id: string, target: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  id,
  senderId: 'alice',
  createdAt: at(minutes),
  contentType: 'EDIT',
  status: 'SENT',
  editsMessageId: target,
  ...extra,
});

const text = (body: string) => ({ status: 'ok' as const, envelope: { v: 1 as const, type: 'text' as const, body } });
const edit = (target: string, body: string, n = 1) => ({
  status: 'ok' as const,
  envelope: { v: 1 as const, type: 'edit' as const, body: { targetMessageId: target, text: body, n } },
});

const bodyOf = (state: unknown) => (state as { envelope: { body: string } }).envelope.body;

describe('isEditMessage', () => {
  it('is true only for the hidden EDIT messages', () => {
    expect(isEditMessage({ contentType: 'EDIT' })).toBe(true);
    expect(isEditMessage({ contentType: 'TEXT' })).toBe(false);
    expect(isEditMessage({})).toBe(false);
  });
});

describe('applyEdits', () => {
  it('leaves messages alone when there are no edits', () => {
    const decrypted = { m1: text('hello') };

    const result = applyEdits([original('m1')], decrypted);

    expect(result.decrypted).toEqual(decrypted);
    expect(result.edited.size).toBe(0);
  });

  it('shows the latest edit as the message text, keeping every version', () => {
    const result = applyEdits(
      [original('m1'), editRow('e1', 'm1', 2), editRow('e2', 'm1', 5)],
      { m1: text('hello'), e1: edit('m1', 'hello there', 1), e2: edit('m1', 'hello there!', 2) },
    );

    expect(bodyOf(result.decrypted.m1)).toBe('hello there!');
    expect(result.edited.get('m1')?.versions.map((version) => version.text)).toEqual([
      'hello',
      'hello there',
      'hello there!',
    ]);
    expect(result.edited.get('m1')?.versions.map((version) => version.at)).toEqual([T0, T0 + 120_000, T0 + 300_000]);
  });

  it('orders edits by when the server stored them, not by the order given', () => {
    const result = applyEdits(
      [original('m1'), editRow('e2', 'm1', 5), editRow('e1', 'm1', 2)],
      { m1: text('a'), e1: edit('m1', 'b'), e2: edit('m1', 'c') },
    );

    expect(bodyOf(result.decrypted.m1)).toBe('c');
  });

  it('does not change the input', () => {
    const decrypted = { m1: text('hello'), e1: edit('m1', 'hi') };

    applyEdits([original('m1'), editRow('e1', 'm1', 1)], decrypted);

    expect(bodyOf(decrypted.m1)).toBe('hello');
  });

  it('can show an edit even when this device never read the original', () => {
    const result = applyEdits(
      [original('m1'), editRow('e1', 'm1', 1)],
      { m1: { status: 'unavailable' }, e1: edit('m1', 'now readable') },
    );

    expect(bodyOf(result.decrypted.m1)).toBe('now readable');
    expect(result.edited.get('m1')?.versions[0]?.text).toBeNull();
  });

  describe('ignores an edit that', () => {
    const attempt = (editOverrides: Record<string, unknown>, targetOverrides: Record<string, unknown> = {}) =>
      applyEdits(
        [original('m1', targetOverrides), editRow('e1', 'm1', 1, editOverrides)],
        { m1: text('hello'), e1: edit('m1', 'forged') },
      );

    it('was sent by someone else', () => {
      expect(bodyOf(attempt({ senderId: 'mallory' }).decrypted.m1)).toBe('hello');
    });

    it('the server does not say is an edit of that message', () => {
      expect(bodyOf(attempt({ editsMessageId: 'other' }).decrypted.m1)).toBe('hello');
      expect(bodyOf(attempt({ editsMessageId: null }).decrypted.m1)).toBe('hello');
    });

    it('came after the 15 minute window', () => {
      expect(bodyOf(attempt({ createdAt: at(15.01) }).decrypted.m1)).toBe('hello');
      expect(bodyOf(attempt({ createdAt: at(15) }).decrypted.m1)).toBe('forged');
    });

    it('was itself unsent', () => {
      expect(bodyOf(attempt({ status: 'DELETED' }).decrypted.m1)).toBe('hello');
    });

    it('is for a message that was unsent', () => {
      expect(bodyOf(attempt({}, { status: 'DELETED' }).decrypted.m1)).toBe('hello');
    });

    it('is for something that is not a text message', () => {
      expect(bodyOf(attempt({}, { contentType: 'FILE' }).decrypted.m1)).toBe('hello');
    });
  });

  it('ignores an edit it cannot read, or one that is not shaped like an edit', () => {
    const result = applyEdits(
      [original('m1'), editRow('e1', 'm1', 1), editRow('e2', 'm1', 2), editRow('e3', 'm1', 3)],
      {
        m1: text('hello'),
        e1: { status: 'pending' },
        e2: { status: 'unavailable' },
        e3: { status: 'ok', envelope: { v: 1, type: 'edit', body: { targetMessageId: 'm1', text: '', n: 1 } } as never },
      },
    );

    expect(bodyOf(result.decrypted.m1)).toBe('hello');
    expect(result.edited.size).toBe(0);
  });

  it('waits for the original to be loaded before applying its edit', () => {
    const result = applyEdits([editRow('e1', 'm1', 1)], { e1: edit('m1', 'early') });

    expect(result.edited.size).toBe(0);
    expect(result.decrypted.m1).toBeUndefined();
  });

  it('counts only the first 10 edits', () => {
    const rows = Array.from({ length: 12 }, (_, i) => editRow(`e${i}`, 'm1', i + 1));
    const states = Object.fromEntries(rows.map((row, i) => [row.id, edit('m1', `v${i}`)]));

    const result = applyEdits([original('m1'), ...rows], { m1: text('v-original'), ...states });

    expect(result.edited.get('m1')?.versions).toHaveLength(11);
    expect(bodyOf(result.decrypted.m1)).toBe('v9');
  });

  it('edits each message on its own', () => {
    const result = applyEdits(
      [original('m1'), original('m2', { senderId: 'bob' }), editRow('e1', 'm1', 1), editRow('e2', 'm2', 1, { senderId: 'bob' })],
      { m1: text('a'), m2: text('b'), e1: edit('m1', 'a2'), e2: edit('m2', 'b2') },
    );

    expect(bodyOf(result.decrypted.m1)).toBe('a2');
    expect(bodyOf(result.decrypted.m2)).toBe('b2');
  });
});
