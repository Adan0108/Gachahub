import { describe, expect, it } from 'vitest';
import type { AttachmentFile } from '../contract/types';
import {
  buildAttachmentEnvelope,
  envelopeBlobIds,
  isAttachmentEnvelope,
} from './attachmentEnvelope';
import { MAX_ATTACHMENT_BYTES, MAX_FILES_PER_MESSAGE } from './limits';

const KEY = 'A'.repeat(43) + '=';
const IV = 'A'.repeat(16);

function file(overrides: Partial<AttachmentFile> = {}): AttachmentFile {
  return {
    name: 'cat.png',
    mime: 'image/png',
    size: 1234,
    blob: 'upload-1',
    key: KEY,
    iv: IV,
    sha256: KEY,
    ...overrides,
  };
}

const envelope = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'attachment',
  files: [file()],
  ...overrides,
});

describe('isAttachmentEnvelope', () => {
  it('accepts a valid envelope with and without caption and thumb', () => {
    expect(isAttachmentEnvelope(envelope())).toBe(true);
    expect(isAttachmentEnvelope(envelope({ body: 'look' }))).toBe(true);
    const thumb = { blob: 'upload-2', key: KEY, iv: IV, sha256: KEY, width: 320, height: 200 };
    expect(isAttachmentEnvelope(envelope({ files: [file({ thumb })] }))).toBe(true);
  });

  it('rejects the wrong shape, version, or type', () => {
    expect(isAttachmentEnvelope(null)).toBe(false);
    expect(isAttachmentEnvelope('x')).toBe(false);
    expect(isAttachmentEnvelope(envelope({ v: 2 }))).toBe(false);
    expect(isAttachmentEnvelope(envelope({ type: 'text' }))).toBe(false);
    expect(isAttachmentEnvelope(envelope({ body: 5 }))).toBe(false);
  });

  it('requires exact base64 for the key, iv and hash', () => {
    const wrongPadding = 'A'.repeat(42) + '==';
    expect(isAttachmentEnvelope(envelope({ files: [file({ key: wrongPadding })] }))).toBe(false);
    expect(isAttachmentEnvelope(envelope({ files: [file({ sha256: 'A'.repeat(44) })] }))).toBe(
      false,
    );
    expect(isAttachmentEnvelope(envelope({ files: [file({ iv: 'A'.repeat(14) + '==' })] }))).toBe(
      false,
    );
  });

  it('requires unique blob ids across files and thumbs', () => {
    const thumb = { blob: 'upload-1', key: KEY, iv: IV, sha256: KEY, width: 4, height: 4 };
    expect(isAttachmentEnvelope(envelope({ files: [file(), file()] }))).toBe(false);
    expect(isAttachmentEnvelope(envelope({ files: [file({ thumb })] }))).toBe(false);
    expect(isAttachmentEnvelope(envelope({ files: [file(), file({ blob: 'upload-2' })] }))).toBe(
      true,
    );
  });

  it('rejects arrays where records are expected', () => {
    expect(isAttachmentEnvelope([])).toBe(false);
    expect(isAttachmentEnvelope(envelope({ files: [[]] }))).toBe(false);
  });

  it('bounds the file count', () => {
    expect(isAttachmentEnvelope(envelope({ files: [] }))).toBe(false);
    expect(isAttachmentEnvelope(envelope({ files: undefined }))).toBe(false);
    const many = Array.from({ length: MAX_FILES_PER_MESSAGE + 1 }, () => file());
    expect(isAttachmentEnvelope(envelope({ files: many }))).toBe(false);
  });

  it('rejects bad file fields', () => {
    const bad = [
      { name: '' },
      { mime: 'x'.repeat(200) },
      { size: -1 },
      { size: 1.5 },
      { size: MAX_ATTACHMENT_BYTES + 1 },
      { blob: '' },
      { key: 'short' },
      { iv: KEY },
      { sha256: 'not base64!!' },
    ];
    for (const overrides of bad) {
      expect(isAttachmentEnvelope(envelope({ files: [file(overrides)] }))).toBe(false);
    }
  });

  it('rejects a malformed thumb', () => {
    const thumb = { blob: 'u', key: KEY, iv: IV, sha256: KEY, width: 0, height: 10 };
    expect(isAttachmentEnvelope(envelope({ files: [file({ thumb })] }))).toBe(false);
    const huge = { ...thumb, width: 5000 };
    expect(isAttachmentEnvelope(envelope({ files: [file({ thumb: huge })] }))).toBe(false);
  });
});

describe('buildAttachmentEnvelope', () => {
  it('trims the caption and omits an empty one', () => {
    expect(buildAttachmentEnvelope([file()], '  hi  ').body).toBe('hi');
    expect('body' in buildAttachmentEnvelope([file()], '   ')).toBe(false);
  });

  it('produces something the validator accepts', () => {
    expect(isAttachmentEnvelope(buildAttachmentEnvelope([file()], 'x'))).toBe(true);
  });
});

describe('envelopeBlobIds', () => {
  it('lists each file blob followed by its thumb blob', () => {
    const thumb = { blob: 't1', key: KEY, iv: IV, sha256: KEY, width: 1, height: 1 };
    expect(envelopeBlobIds([file({ blob: 'a', thumb }), file({ blob: 'b' })])).toEqual([
      'a',
      't1',
      'b',
    ]);
  });
});
