import { describe, expect, it } from 'vitest';
import { buildTextEnvelope, previewBlobIds, readLinkPreviews } from './linkPreviewEnvelope';

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64');
const thumb = (extra: Record<string, unknown> = {}) => ({
  blob: 'upload-1',
  key: b64(32),
  iv: b64(12),
  sha256: b64(32),
  width: 320,
  height: 180,
  ...extra,
});

const URL_IN_TEXT = 'https://example.com/post';
const text = `look at ${URL_IN_TEXT} it is good`;
const envelope = (previews: unknown, body: unknown = text, extra: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'text',
  body,
  previews,
  ...extra,
});
const card = (extra: Record<string, unknown> = {}) => ({ url: URL_IN_TEXT, title: 'A post', ...extra });

describe('readLinkPreviews', () => {
  it('reads a card for a link in the message', () => {
    const result = readLinkPreviews(
      envelope([
        card({ description: 'About a thing', siteName: 'Example', thumb: thumb() }),
      ]),
    );

    expect(result).toEqual([
      {
        url: 'https://example.com/post',
        title: 'A post',
        description: 'About a thing',
        siteName: 'Example',
        thumb: thumb(),
      },
    ]);
  });

  it('leaves out the parts that are not there', () => {
    expect(readLinkPreviews(envelope([card()]))).toEqual([{ url: URL_IN_TEXT, title: 'A post' }]);
  });

  it('shows a card with just a picture', () => {
    expect(readLinkPreviews(envelope([{ url: URL_IN_TEXT, thumb: thumb() }]))).toEqual([
      { url: URL_IN_TEXT, thumb: thumb() },
    ]);
  });

  it('has nothing for a message without previews', () => {
    expect(readLinkPreviews({ v: 1, type: 'text', body: text })).toEqual([]);
    expect(readLinkPreviews(envelope([]))).toEqual([]);
  });

  describe('a card must be for a link that is really in the message', () => {
    it('refuses a card for an address that is not in the text', () => {
      expect(readLinkPreviews(envelope([card({ url: 'https://evil.example/login' })]))).toEqual([]);
    });

    it('refuses a card whose address only resembles the one in the text', () => {
      expect(readLinkPreviews(envelope([card({ url: 'https://example.com/post2' })]))).toEqual([]);
      expect(readLinkPreviews(envelope([card({ url: 'https://example.com.evil.example/post' })]))).toEqual([]);
      expect(readLinkPreviews(envelope([card({ url: 'http://example.com/post' })]))).toEqual([]);
    });

    it('accepts the same page when the text has a fragment or the card does', () => {
      expect(readLinkPreviews(envelope([card()], 'see https://example.com/post#comments'))).toHaveLength(1);
      expect(readLinkPreviews(envelope([card({ url: 'https://example.com/post#x' })]))).toHaveLength(1);
    });

    it('accepts a card for a bare www link in the text', () => {
      expect(
        readLinkPreviews(envelope([card({ url: 'https://www.example.com/a' })], 'try www.example.com/a please')),
      ).toHaveLength(1);
    });

    it('accepts a card for any one of several links in the text', () => {
      const body = 'https://first.example/a and https://example.com/post';

      expect(readLinkPreviews(envelope([card()], body))).toHaveLength(1);
    });

    it('refuses a card when the text has no link at all', () => {
      expect(readLinkPreviews(envelope([card()], 'no links here'))).toEqual([]);
    });
  });

  describe('what a hostile sender might put in a card', () => {
    it.each([
      ['javascript', 'javascript:alert(1)'],
      ['data', 'data:text/html,<script>alert(1)</script>'],
      ['file', 'file:///etc/passwd'],
      ['credentials', 'https://paypal.com@evil.example/'],
      ['not a link', 'nope'],
      ['empty', ''],
      ['a number', 42],
      ['missing', undefined],
    ])('refuses a %s address', (_name, url) => {
      expect(readLinkPreviews(envelope([card({ url })], `x ${String(url)} y`))).toEqual([]);
    });

    it('refuses an address that is far too long', () => {
      const url = `https://example.com/${'a'.repeat(2100)}`;

      expect(readLinkPreviews(envelope([card({ url })], url))).toEqual([]);
    });

    it('tidies the text, taking out invisible and direction-changing characters', () => {
      const [result] = readLinkPreviews(
        envelope([card({ title: `Free${String.fromCodePoint(0x202e)} gift${String.fromCodePoint(0x200b)}  card` })]),
      );

      expect(result!.title).toBe('Free gift card');
    });

    it('cuts text that is too long', () => {
      const [result] = readLinkPreviews(
        envelope([card({ title: 'x'.repeat(1000), description: 'y'.repeat(1000), siteName: 'z'.repeat(1000) })]),
      );

      expect(result!.title).toHaveLength(200);
      expect(result!.description).toHaveLength(300);
      expect(result!.siteName).toHaveLength(100);
    });

    it('keeps markup as plain text rather than reading it', () => {
      const [result] = readLinkPreviews(envelope([card({ title: '<img src=x onerror=alert(1)>' })]));

      expect(result!.title).toBe('<img src=x onerror=alert(1)>');
    });

    it('refuses a card with no title and no picture', () => {
      expect(readLinkPreviews(envelope([{ url: URL_IN_TEXT, description: 'only this' }]))).toEqual([]);
      expect(readLinkPreviews(envelope([{ url: URL_IN_TEXT, title: '   ' }]))).toEqual([]);
    });

    it('drops a malformed picture but keeps the card', () => {
      const [result] = readLinkPreviews(envelope([card({ thumb: thumb({ key: 'short' }) })]));

      expect(result).toEqual({ url: URL_IN_TEXT, title: 'A post' });
    });

    it.each([
      ['a picture that is too big', { width: 5000 }],
      ['a picture with no size', { width: 0 }],
      ['a picture with a bad hash', { sha256: 'nope' }],
      ['a picture with no blob', { blob: '' }],
    ])('drops %s', (_name, bad) => {
      const [result] = readLinkPreviews(envelope([card({ thumb: thumb(bad) })]));

      expect(result!.thumb).toBeUndefined();
    });

    it('shows only the first valid card, however many are sent', () => {
      const result = readLinkPreviews(
        envelope([
          card({ url: 'https://evil.example/' }),
          card({ title: 'First good one' }),
          card({ title: 'Second good one' }),
        ]),
      );

      expect(result).toEqual([{ url: URL_IN_TEXT, title: 'First good one' }]);
    });

    it.each([
      ['null', null],
      ['a string', 'text'],
      ['a number', 5],
      ['an array', [[]]],
    ])('skips a card that is %s', (_name, bad) => {
      expect(readLinkPreviews(envelope([bad]))).toEqual([]);
    });

    it.each([
      ['an object', {}],
      ['a string', 'x'],
      ['null', null],
      ['a number', 3],
    ])('has nothing when previews is %s', (_name, previews) => {
      expect(readLinkPreviews(envelope(previews))).toEqual([]);
    });
  });

  describe('only a text message can have a card', () => {
    it.each([
      ['a reaction', { type: 'reaction' }],
      ['a delete', { type: 'delete' }],
      ['an edit', { type: 'edit' }],
      ['an attachment', { type: 'attachment' }],
      ['a different version', { v: 2 }],
    ])('refuses %s', (_name, change) => {
      expect(readLinkPreviews(envelope([card()], text, change))).toEqual([]);
    });

    it('refuses a message whose text is not text', () => {
      expect(readLinkPreviews(envelope([card()], 42))).toEqual([]);
    });

    it.each([[null], [undefined], ['text'], [7], [[]]])('has nothing for %p', (value) => {
      expect(readLinkPreviews(value)).toEqual([]);
    });
  });
});

describe('buildTextEnvelope', () => {
  it('is a plain text message without a preview', () => {
    expect(buildTextEnvelope('hello')).toEqual({ v: 1, type: 'text', body: 'hello' });
  });

  it('carries the preview when there is one', () => {
    const preview = { url: URL_IN_TEXT, title: 'A post' };

    expect(buildTextEnvelope(text, preview)).toEqual({ v: 1, type: 'text', body: text, previews: [preview] });
  });

  it('builds something readLinkPreviews gives back', () => {
    const preview = { url: URL_IN_TEXT, title: 'A post', thumb: thumb() };

    expect(readLinkPreviews(buildTextEnvelope(text, preview))).toEqual([preview]);
  });
});

describe('previewBlobIds', () => {
  it('lists the picture to attach', () => {
    expect(previewBlobIds({ url: URL_IN_TEXT, thumb: thumb() })).toEqual(['upload-1']);
  });

  it('has nothing to attach for a card with no picture, or no card', () => {
    expect(previewBlobIds({ url: URL_IN_TEXT, title: 'A post' })).toEqual([]);
    expect(previewBlobIds(undefined)).toEqual([]);
  });
});
