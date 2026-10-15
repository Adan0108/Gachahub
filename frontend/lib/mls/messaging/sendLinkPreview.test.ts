import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkPreviewData } from '../media/prepareLinkPreview';
import { prepareLinkPreview } from '../media/prepareLinkPreview';
import { previewForSend, type PreparedPreviews } from './sendLinkPreview';

vi.mock('../../api', () => ({ api: { uploadChatBlobs: vi.fn() } }));
vi.mock('../media/prepareLinkPreview', () => ({ prepareLinkPreview: vi.fn() }));

const data: LinkPreviewData = {
  url: 'https://example.com/post',
  domain: 'example.com',
  resolvedDomain: null,
  title: 'A post',
  description: null,
  siteName: null,
  image: null,
};
const card = { url: 'https://example.com/post', title: 'A post' };

describe('previewForSend', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prepareLinkPreview).mockResolvedValue(card);
  });

  it('has no card for a message with no preview', async () => {
    const result = await previewForSend({ preview: undefined, clientMessageId: 'c1', prepared: new Map() });

    expect(result).toBeUndefined();
    expect(prepareLinkPreview).not.toHaveBeenCalled();
  });

  it('prepares the card, uploading through the chat blob upload', async () => {
    const result = await previewForSend({ preview: data, clientMessageId: 'c1', prepared: new Map() });

    expect(result).toEqual(card);
    const [passed, upload] = vi.mocked(prepareLinkPreview).mock.calls[0]!;
    expect(passed).toBe(data);
    expect(upload).toBeTypeOf('function');
  });

  it('hands the same card back on a retry, without preparing or uploading again', async () => {
    const prepared: PreparedPreviews = new Map();

    const first = await previewForSend({ preview: data, clientMessageId: 'c1', prepared });
    const retry = await previewForSend({ preview: data, clientMessageId: 'c1', prepared });

    expect(retry).toBe(first);
    expect(prepareLinkPreview).toHaveBeenCalledTimes(1);
  });

  it('remembers that a message ended up with no card, so a retry does not try again', async () => {
    vi.mocked(prepareLinkPreview).mockResolvedValue(undefined);
    const prepared: PreparedPreviews = new Map();

    await previewForSend({ preview: data, clientMessageId: 'c1', prepared });
    const retry = await previewForSend({ preview: data, clientMessageId: 'c1', prepared });

    expect(retry).toBeUndefined();
    expect(prepareLinkPreview).toHaveBeenCalledTimes(1);
  });

  it('prepares each message on its own', async () => {
    const prepared: PreparedPreviews = new Map();

    await previewForSend({ preview: data, clientMessageId: 'c1', prepared });
    await previewForSend({ preview: data, clientMessageId: 'c2', prepared });

    expect(prepareLinkPreview).toHaveBeenCalledTimes(2);
  });
});
