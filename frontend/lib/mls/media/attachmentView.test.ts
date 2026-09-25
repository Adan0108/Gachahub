import { describe, expect, it } from 'vitest';
import type { AttachmentFile } from '../contract/types';
import {
  attachmentKind,
  envelopeView,
  formatBytes,
  groupAttachments,
  pendingStatusLabel,
  safeBlobType,
  safeFileName,
} from './attachmentView';

const KEY = 'A'.repeat(43) + '=';
const file = (name: string, mime: string): AttachmentFile => ({
  name,
  mime,
  size: 10,
  blob: name,
  key: KEY,
  iv: 'A'.repeat(16),
  sha256: KEY,
});

describe('attachmentKind / safeBlobType', () => {
  it('classifies renderable images and videos only', () => {
    expect(attachmentKind('image/PNG')).toBe('image');
    expect(attachmentKind('video/mp4')).toBe('video');
    expect(attachmentKind('image/svg+xml')).toBe('file');
    expect(attachmentKind('text/html')).toBe('file');
    expect(attachmentKind('')).toBe('file');
  });

  it('keeps a claimed mime only when it is one we render', () => {
    expect(safeBlobType('image/jpeg')).toBe('image/jpeg');
    expect(safeBlobType('text/html')).toBe('application/octet-stream');
  });
});

describe('safeFileName', () => {
  it('drops path parts, control characters and leading dots', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\a.txt')).toBe('a.txt');
    expect(safeFileName('.hidden')).toBe('hidden');
    expect(safeFileName('a\u0000b<>.txt')).toBe('ab.txt');
  });

  it('strips bidi overrides and zero-width characters', () => {
    expect(safeFileName('inv‮exe.txt')).toBe('invexe.txt');
    expect(safeFileName('a​b⁦c⁩d.txt')).toBe('abcd.txt');
    expect(safeFileName('a﻿b')).toBe('ab');
  });

  it('drops trailing dots and spaces', () => {
    expect(safeFileName('name. . ')).toBe('name');
    expect(safeFileName('...')).toBe('file');
  });

  it('defuses Windows reserved device names', () => {
    expect(safeFileName('CON')).toBe('_CON');
    expect(safeFileName('nul.txt')).toBe('_nul.txt');
    expect(safeFileName('Lpt9.log')).toBe('_Lpt9.log');
    expect(safeFileName('com10.txt')).toBe('com10.txt');
    expect(safeFileName('console.txt')).toBe('console.txt');
  });

  it('falls back and truncates', () => {
    expect(safeFileName('///')).toBe('file');
    expect(safeFileName('x'.repeat(500)).length).toBe(120);
  });
});

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('groupAttachments', () => {
  it('separates visual files from chips and keeps original indices', () => {
    const files = [
      file('a.png', 'image/png'),
      file('b.pdf', 'application/pdf'),
      file('c.mp4', 'video/mp4'),
    ];
    const { visual, others } = groupAttachments(files);

    expect(visual.map((item) => item.index)).toEqual([0, 2]);
    expect(others.map((item) => item.index)).toEqual([1]);
  });

  it('handles no files', () => {
    expect(groupAttachments([])).toEqual({ visual: [], others: [] });
  });
});

describe('envelopeView', () => {
  it('shows text and valid attachments', () => {
    expect(envelopeView({ v: 1, type: 'text', body: 'hi' })).toEqual({ kind: 'text', text: 'hi' });
    const view = envelopeView({
      v: 1,
      type: 'attachment',
      body: 'cap',
      files: [file('a.png', 'image/png')],
    });
    expect(view).toMatchObject({ kind: 'attachment', caption: 'cap' });
  });

  it('never surfaces other or malformed envelopes', () => {
    expect(envelopeView({ v: 1, type: 'reaction', body: { emoji: 'x' } })).toBeNull();
    expect(envelopeView({ v: 1, type: 'edit', body: 'x' })).toBeNull();
    expect(envelopeView({ v: 1, type: 'attachment', files: [{ name: 'x' }] })).toBeNull();
    expect(envelopeView({ v: 1, type: 'text', body: { a: 1 } })).toBeNull();
    expect(envelopeView(undefined)).toBeNull();
  });
});

describe('pendingStatusLabel', () => {
  it('maps stages to labels', () => {
    expect(pendingStatusLabel('encrypting')).toBe('Encrypting...');
    expect(pendingStatusLabel('uploading')).toBe('Uploading...');
    expect(pendingStatusLabel()).toBe('Sending...');
  });
});
