import { describe, expect, it } from 'vitest';
import type { AttachmentFile } from '../contract/types';
import {
  attachmentKind,
  autoLoadsWithoutTap,
  chunkVisualAttachments,
  envelopeView,
  flattenOtherAttachments,
  flattenVisualAttachments,
  formatBytes,
  groupAttachments,
  isMediaOnlyView,
  pendingStatusLabel,
  resolveAttachmentSources,
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
    expect(attachmentKind('image/avif')).toBe('image');
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

describe('chunkVisualAttachments', () => {
  it('keeps everything in one section when at or under the limit', () => {
    expect(chunkVisualAttachments([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(chunkVisualAttachments([1, 2, 3, 4, 5, 6])).toEqual([[1, 2, 3, 4, 5, 6]]);
  });

  it('spills a 7th item into its own second section', () => {
    expect(chunkVisualAttachments([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 2, 3, 4, 5, 6], [7]]);
  });

  it('handles no attachments', () => {
    expect(chunkVisualAttachments([])).toEqual([]);
  });

  it('honors a custom section size', () => {
    expect(chunkVisualAttachments([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
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

describe('autoLoadsWithoutTap', () => {
  it('is true only for gif, case-insensitively', () => {
    expect(autoLoadsWithoutTap('image/gif')).toBe(true);
    expect(autoLoadsWithoutTap('IMAGE/GIF')).toBe(true);
    expect(autoLoadsWithoutTap('image/png')).toBe(false);
    expect(autoLoadsWithoutTap('video/mp4')).toBe(false);
  });
});

describe('isMediaOnlyView', () => {
  it('is true for an uncaptioned attachment made only of images/video', () => {
    expect(
      isMediaOnlyView({ kind: 'attachment', caption: '', files: [file('a.png', 'image/png')] }),
    ).toBe(true);
  });

  it('is false with a caption, a non-visual file, no files, or a text view', () => {
    expect(
      isMediaOnlyView({ kind: 'attachment', caption: 'hi', files: [file('a.png', 'image/png')] }),
    ).toBe(false);
    expect(
      isMediaOnlyView({ kind: 'attachment', caption: '', files: [file('a.pdf', 'application/pdf')] }),
    ).toBe(false);
    expect(isMediaOnlyView({ kind: 'attachment', caption: '', files: [] })).toBe(false);
    expect(isMediaOnlyView({ kind: 'text', text: 'hi' })).toBe(false);
    expect(isMediaOnlyView(null)).toBe(false);
  });
});

describe('resolveAttachmentSources', () => {
  it('splits visual from file attachments and resolves each url from the upload id', () => {
    const image = file('a.png', 'image/png');
    const pdf = file('b.pdf', 'application/pdf');
    const urlByUploadId = new Map([
      ['a.png', 'https://res.cloudinary.com/a'],
      ['b.pdf', 'https://res.cloudinary.com/b'],
    ]);
    const { visual, others } = resolveAttachmentSources('m1', [image, pdf], urlByUploadId);
    expect(visual).toEqual([
      {
        file: image,
        index: 0,
        source: { cacheKey: 'm1:0:file', url: 'https://res.cloudinary.com/a', ref: image, mime: 'image/png', size: 10 },
        thumbSource: null,
      },
    ]);
    expect(others[0]).toMatchObject({ file: pdf, source: { cacheKey: 'm1:1:file' } });
  });

  it('leaves the source null when the upload id has no url yet', () => {
    const image = file('a.png', 'image/png');
    const { visual } = resolveAttachmentSources('m1', [image], new Map());
    expect(visual[0]!.source).toBeNull();
  });
});

describe('flattenVisualAttachments', () => {
  it('collects visual attachments only from ok-decrypted attachment messages, in order', () => {
    const attachmentEnvelope = {
      v: 1,
      type: 'attachment',
      files: [file('a.png', 'image/png')],
    };
    const messages = [
      { id: 'm1', media: [{ mediaUploadId: 'a.png', url: 'https://res.cloudinary.com/a' }] },
      { id: 'm2' }, // not decrypted
      { id: 'm3', media: [{ mediaUploadId: 'a.png', url: 'https://res.cloudinary.com/b' }] },
    ];
    const decryptedById = {
      m1: { status: 'ok', envelope: attachmentEnvelope },
      m2: { status: 'pending' },
      m3: { status: 'ok', envelope: { v: 1, type: 'text', body: 'hi' } },
    };
    const flat = flattenVisualAttachments(messages, decryptedById);
    expect(flat).toEqual([
      {
        cacheKey: 'm1:0:file',
        messageId: 'm1',
        file: attachmentEnvelope.files[0],
        source: {
          cacheKey: 'm1:0:file',
          url: 'https://res.cloudinary.com/a',
          ref: attachmentEnvelope.files[0],
          mime: 'image/png',
          size: 10,
        },
        thumbSource: null,
      },
    ]);
  });
});

describe('flattenOtherAttachments', () => {
  it('collects only the non-visual (file-chip) attachments, in order', () => {
    const image = file('a.png', 'image/png');
    const pdf = file('b.pdf', 'application/pdf');
    const messages = [
      {
        id: 'm1',
        media: [
          { mediaUploadId: 'a.png', url: 'https://res.cloudinary.com/a' },
          { mediaUploadId: 'b.pdf', url: 'https://res.cloudinary.com/b' },
        ],
      },
    ];
    const decryptedById = {
      m1: {
        status: 'ok',
        envelope: { v: 1, type: 'attachment', files: [image, pdf] },
      },
    };

    const flat = flattenOtherAttachments(messages, decryptedById);

    expect(flat).toEqual([
      {
        cacheKey: 'm1:1:file',
        messageId: 'm1',
        file: pdf,
        source: {
          cacheKey: 'm1:1:file',
          url: 'https://res.cloudinary.com/b',
          ref: pdf,
          mime: 'application/pdf',
          size: 10,
        },
        thumbSource: null,
      },
    ]);
  });

  it('skips messages that are not ok-decrypted attachment envelopes, and files with no resolved url', () => {
    const pdf = file('b.pdf', 'application/pdf');
    const messages = [
      { id: 'm1', media: [] }, // no url for b.pdf yet
      { id: 'm2' }, // not decrypted
      { id: 'm3' },
    ];
    const decryptedById = {
      m1: { status: 'ok', envelope: { v: 1, type: 'attachment', files: [pdf] } },
      m2: { status: 'pending' },
      m3: { status: 'ok', envelope: { v: 1, type: 'text', body: 'hi' } },
    };

    expect(flattenOtherAttachments(messages, decryptedById)).toEqual([]);
  });
});
