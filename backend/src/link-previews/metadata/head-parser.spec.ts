import { parseHeadMetadata } from './head-parser';

// Built from code points so the invisible characters are visible in this file.
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const PDF = String.fromCodePoint(0x202c); // pop directional formatting

const BASE = new URL('https://example.com/articles/one');
const page = (head: string, body = '<p>hello</p>') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('parseHeadMetadata', () => {
  it('reads the Open Graph tags', () => {
    const result = parseHeadMetadata(
      page(`
        <meta property="og:title" content="A Great Game">
        <meta property="og:description" content="Pull for your favourite.">
        <meta property="og:site_name" content="Gacha News">
        <meta property="og:image" content="https://cdn.example.com/cover.png">
      `),
      BASE,
    );

    expect(result).toEqual({
      title: 'A Great Game',
      description: 'Pull for your favourite.',
      siteName: 'Gacha News',
      imageUrl: 'https://cdn.example.com/cover.png',
    });
  });

  it('falls back to Twitter cards, then to the plain tags', () => {
    expect(
      parseHeadMetadata(
        page(`
          <meta name="twitter:title" content="Tweet title">
          <meta name="twitter:description" content="Tweet description">
          <meta name="twitter:image" content="/img/card.jpg">
        `),
        BASE,
      ),
    ).toMatchObject({
      title: 'Tweet title',
      description: 'Tweet description',
      imageUrl: 'https://example.com/img/card.jpg',
    });

    expect(
      parseHeadMetadata(
        page(
          '<title>Plain title</title><meta name="description" content="Plain description">',
        ),
        BASE,
      ),
    ).toMatchObject({ title: 'Plain title', description: 'Plain description' });
  });

  it('prefers Open Graph over everything else', () => {
    const result = parseHeadMetadata(
      page(`
        <title>Tag title</title>
        <meta name="twitter:title" content="Twitter title">
        <meta property="og:title" content="OG title">
      `),
      BASE,
    );

    expect(result.title).toBe('OG title');
  });

  it('prefers the secure image URL', () => {
    const result = parseHeadMetadata(
      page(`
        <meta property="og:image" content="http://example.com/a.png">
        <meta property="og:image:secure_url" content="https://example.com/a.png">
      `),
      BASE,
    );

    expect(result.imageUrl).toBe('https://example.com/a.png');
  });

  it('resolves a relative image against the page address', () => {
    expect(
      parseHeadMetadata(
        page('<meta property="og:image" content="../cover.png">'),
        BASE,
      ).imageUrl,
    ).toBe('https://example.com/cover.png');
    expect(
      parseHeadMetadata(
        page('<meta property="og:image" content="//cdn.test/c.png">'),
        BASE,
      ).imageUrl,
    ).toBe('https://cdn.test/c.png');
  });

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:image/png;base64,AAAA'],
    ['file', 'file:///etc/passwd'],
    ['ftp', 'ftp://example.com/a.png'],
  ])('drops a %s image address', (_name, value) => {
    expect(
      parseHeadMetadata(
        page(`<meta property="og:image" content="${value}">`),
        BASE,
      ).imageUrl,
    ).toBeUndefined();
  });

  it('drops an image address that is absurdly long', () => {
    const content = `https://example.com/${'a'.repeat(2100)}`;

    expect(
      parseHeadMetadata(
        page(`<meta property="og:image" content="${content}">`),
        BASE,
      ).imageUrl,
    ).toBeUndefined();
  });

  it('decodes entities and tidies the text', () => {
    const result = parseHeadMetadata(
      page(
        '<meta property="og:title" content="  Fish &amp; Chips &#8211;\n  Best  ">',
      ),
      BASE,
    );

    expect(result.title).toBe('Fish & Chips – Best');
  });

  it('strips direction overrides from a spoofed title', () => {
    const result = parseHeadMetadata(
      page(
        `<meta property="og:title" content="Login to ${RLO}lapyap${PDF} account">`,
      ),
      BASE,
    );

    expect(result.title).toBe('Login to lapyap account');
  });

  it('limits the length of every text field', () => {
    const long = 'x'.repeat(1000);
    const result = parseHeadMetadata(
      page(`
        <meta property="og:title" content="${long}">
        <meta property="og:description" content="${long}">
        <meta property="og:site_name" content="${long}">
      `),
      BASE,
    );

    expect(result.title).toHaveLength(200);
    expect(result.description).toHaveLength(300);
    expect(result.siteName).toHaveLength(100);
  });

  it('reads only the first title tag', () => {
    const result = parseHeadMetadata(
      page('<title>First</title><title>Second</title>'),
      BASE,
    );

    expect(result.title).toBe('First');
  });

  it('ignores tags in the body, where a user could have written them', () => {
    const result = parseHeadMetadata(
      page(
        '<title>Real</title>',
        '<meta property="og:title" content="Injected"><title>Also injected</title>',
      ),
      BASE,
    );

    expect(result.title).toBe('Real');
  });

  it('keeps the first of a repeated tag', () => {
    const result = parseHeadMetadata(
      page(`
        <meta property="og:title" content="First">
        <meta property="og:title" content="Second">
      `),
      BASE,
    );

    expect(result.title).toBe('First');
  });

  it('reads attribute names regardless of case and order', () => {
    const result = parseHeadMetadata(
      page('<META CONTENT="Shouty" PROPERTY="OG:TITLE">'),
      BASE,
    );

    expect(result.title).toBe('Shouty');
  });

  it('does not run or follow anything in the page', () => {
    const result = parseHeadMetadata(
      page(`
        <script>throw new Error('executed')</script>
        <meta http-equiv="refresh" content="0; url=http://169.254.169.254/">
        <meta property="og:title" content="Safe">
      `),
      BASE,
    );

    expect(result).toEqual({
      title: 'Safe',
      description: undefined,
      siteName: undefined,
      imageUrl: undefined,
    });
  });

  it('copes with a page that has no head close tag', () => {
    const result = parseHeadMetadata(
      '<html><head><meta property="og:title" content="Unclosed">',
      BASE,
    );

    expect(result.title).toBe('Unclosed');
  });

  it('gives nothing for a page with no metadata', () => {
    expect(
      parseHeadMetadata('<html><body>just text</body></html>', BASE),
    ).toEqual({
      title: undefined,
      description: undefined,
      siteName: undefined,
      imageUrl: undefined,
    });
  });

  it('copes with garbage input', () => {
    expect(() => parseHeadMetadata('<<<>>><meta <title', BASE)).not.toThrow();
    expect(() => parseHeadMetadata('', BASE)).not.toThrow();
  });
});
