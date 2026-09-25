import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./attachmentLoader', () => ({
  loadAttachmentBlob: vi.fn(async () => new Blob(['x'])),
}));

import { REVOKE_DELAY_MS, saveAttachment } from './saveAttachment';

const source = {
  cacheKey: 'k',
  url: 'https://res.cloudinary.com/a',
  ref: { blob: 'b', key: 'k', iv: 'i', sha256: 's' },
  mime: 'text/plain',
};

describe('saveAttachment', () => {
  const link = { click: vi.fn(), remove: vi.fn(), href: '', download: '' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => link),
      body: { append: vi.fn() },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads under a sanitised name', async () => {
    await saveAttachment(source, '../evil‮exe.txt');

    expect(link.download).toBe('evilexe.txt');
    expect(link.click).toHaveBeenCalled();
  });

  it('revokes the object url only after the delay', async () => {
    await saveAttachment(source, 'a.txt');

    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one');
  });
});
