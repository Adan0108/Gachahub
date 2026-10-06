import { oembedRequestUrl, parseOembed } from './oembed';

// Built from code points so the invisible characters are visible in this file.
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const ZWSP = String.fromCodePoint(0x200b); // zero-width space

describe('oembedRequestUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc123'],
    ['https://youtube.com/watch?v=abc123'],
    ['https://m.youtube.com/watch?v=abc123'],
    ['https://music.youtube.com/watch?v=abc123'],
    ['https://youtu.be/abc123'],
    ['https://WWW.YOUTUBE.COM/watch?v=abc123'],
  ])('asks YouTube about %s', (link) => {
    const request = new URL(oembedRequestUrl(new URL(link))!);

    expect(request.origin + request.pathname).toBe(
      'https://www.youtube.com/oembed',
    );
    expect(request.searchParams.get('url')).toBe(new URL(link).href);
    expect(request.searchParams.get('format')).toBe('json');
  });

  it.each([
    ['https://example.com/watch?v=abc123'],
    ['https://youtube.com.evil.example/watch?v=abc123'],
    ['https://notyoutube.com/watch?v=abc123'],
    ['https://evil.example/?u=https://www.youtube.com/watch?v=abc123'],
  ])('does not treat %s as YouTube', (link) => {
    expect(oembedRequestUrl(new URL(link))).toBeNull();
  });

  it('keeps a hostile link inside the url parameter instead of changing the request', () => {
    const link = new URL(
      'https://www.youtube.com/watch?v=a&format=xml&url=http://169.254.169.254/',
    );

    const request = new URL(oembedRequestUrl(link)!);

    expect(request.searchParams.getAll('format')).toEqual(['json']);
    expect(request.searchParams.getAll('url')).toEqual([link.href]);
    expect(request.hostname).toBe('www.youtube.com');
  });
});

describe('parseOembed', () => {
  it('reads the fields we use', () => {
    expect(
      parseOembed({
        title: 'A video',
        author_name: 'A channel',
        provider_name: 'YouTube',
        thumbnail_url: 'https://i.ytimg.com/vi/abc/hq.jpg',
        html: '<iframe src="https://evil.example"></iframe>',
      }),
    ).toEqual({
      title: 'A video',
      authorName: 'A channel',
      providerName: 'YouTube',
      thumbnailUrl: 'https://i.ytimg.com/vi/abc/hq.jpg',
    });
  });

  it('cleans the text it keeps', () => {
    expect(parseOembed({ title: `Free${RLO} gift${ZWSP}  card` }).title).toBe(
      'Free gift card',
    );
  });

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:image/png;base64,AAAA'],
    ['not a link', 'nope'],
    ['not text', 42],
  ])('drops a %s thumbnail address', (_name, thumbnail) => {
    expect(
      parseOembed({ thumbnail_url: thumbnail }).thumbnailUrl,
    ).toBeUndefined();
  });

  it.each([[null], ['text'], [42], [[]], [undefined]])(
    'copes with %p instead of an object',
    (value) => {
      expect(parseOembed(value)).toEqual({});
    },
  );

  it('ignores fields of the wrong type', () => {
    expect(
      parseOembed({ title: 5, author_name: {}, provider_name: [] }),
    ).toEqual({
      title: undefined,
      authorName: undefined,
      providerName: undefined,
      thumbnailUrl: undefined,
    });
  });
});
