import { describe, expect, it } from 'vitest';
import { findLinks, splitLinks, withoutFragment } from './linkify';

const hrefs = (text: string) => findLinks(text).map((link) => link.href);
const texts = (text: string) => findLinks(text).map((link) => link.text);

describe('findLinks', () => {
  it('finds http and https links', () => {
    expect(hrefs('go to http://example.com and https://example.org/a?b=1')).toEqual([
      'http://example.com/',
      'https://example.org/a?b=1',
    ]);
  });

  it('adds a scheme to a bare www address, and shows it as written', () => {
    const [link] = findLinks('visit www.example.com/path now');

    expect(link).toMatchObject({ text: 'www.example.com/path', href: 'https://www.example.com/path' });
  });

  it('reports where each link sits in the text', () => {
    const text = 'see https://example.com ok';
    const [link] = findLinks(text);

    expect(text.slice(link!.start, link!.end)).toBe('https://example.com');
  });

  it('is case-insensitive about the scheme', () => {
    expect(hrefs('HTTPS://EXAMPLE.COM/Path')).toEqual(['https://example.com/Path']);
    expect(hrefs('WWW.example.com')).toEqual(['https://www.example.com/']);
  });

  describe('punctuation around a link', () => {
    it.each([
      ['see https://example.com/a.', 'https://example.com/a'],
      ['see https://example.com/a, then', 'https://example.com/a'],
      ['did you see https://example.com/a?', 'https://example.com/a'],
      ['wow https://example.com/a!', 'https://example.com/a'],
      ['(https://example.com/a)', 'https://example.com/a'],
      ['[https://example.com/a]', 'https://example.com/a'],
      ['"https://example.com/a"', 'https://example.com/a'],
      ["'https://example.com/a'", 'https://example.com/a'],
      ['https://example.com/a).', 'https://example.com/a'],
      ['https://example.com/a...', 'https://example.com/a'],
      ['https://example.com/a;', 'https://example.com/a'],
      ['https://example.com/a:', 'https://example.com/a'],
    ])('%s', (text, expected) => {
      expect(texts(text)).toEqual([expected]);
    });

    it('keeps a closing bracket that belongs to the link', () => {
      expect(texts('https://en.wikipedia.org/wiki/Gacha_(disambiguation)')).toEqual([
        'https://en.wikipedia.org/wiki/Gacha_(disambiguation)',
      ]);
      expect(texts('(see https://en.wikipedia.org/wiki/Gacha_(game))')).toEqual([
        'https://en.wikipedia.org/wiki/Gacha_(game)',
      ]);
    });

    it('keeps the query and a trailing slash', () => {
      expect(texts('https://example.com/search?q=a&b=c#top/')).toEqual(['https://example.com/search?q=a&b=c#top/']);
    });
  });

  describe('what is not a link', () => {
    it.each([
      ['a bare domain', 'visit example.com today'],
      ['a file name', 'open index.js'],
      ['an email address', 'mail me@example.com'],
      ['an email at a www host', 'mail me@www.example.com'],
      ['a mailto link', 'mailto:me@example.com'],
      ['a javascript link', 'javascript:alert(1)'],
      ['a data link', 'data:text/html,<script>alert(1)</script>'],
      ['an ftp link', 'ftp://example.com/file'],
      ['a file link', 'file:///etc/passwd'],
      ['a scheme glued to a word', 'xhttp://example.com'],
      ['a link inside a longer path', 'a/https://example.com'],
      ['a scheme with nothing after it', 'http://'],
      ['a name with no dot', 'http://localhost/admin'],
      ['a name that starts with a dot', 'http://.example.com'],
      ['credentials in the address', 'https://paypal.com@evil.example/login'],
      ['a password in the address', 'https://user:pass@example.com/'],
    ])('leaves %s alone', (_name, text) => {
      expect(findLinks(text)).toEqual([]);
    });

    it('leaves a link longer than 2048 characters alone', () => {
      expect(findLinks(`https://example.com/${'a'.repeat(2100)}`)).toEqual([]);
    });
  });

  it('turns a non-latin name into its punycode form, so what is shown matches where it goes', () => {
    const [link] = findLinks('https://bücher.example/x');

    expect(link!.text).toBe('https://bücher.example/x');
    expect(link!.href).toBe('https://xn--bcher-kva.example/x');
  });

  it('finds a link next to markup characters without taking the markup', () => {
    expect(texts('<a href="https://example.com/a">hi</a>')).toEqual(['https://example.com/a']);
  });

  it('copes with no text and with only whitespace', () => {
    expect(findLinks('')).toEqual([]);
    expect(findLinks('   \n\t ')).toEqual([]);
  });

  it('does not take long to look at a long run of nothing in particular', () => {
    const started = Date.now();

    findLinks(`${'http://'.repeat(5000)}${'(' .repeat(5000)}`);
    findLinks('a'.repeat(100_000));

    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('splitLinks', () => {
  it('cuts the text into plain pieces and links that add up to the original', () => {
    const text = 'before https://example.com/a, middle www.example.org after';

    const segments = splitLinks(text);

    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    expect(segments).toEqual([
      { text: 'before ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: ', middle ' },
      { text: 'www.example.org', href: 'https://www.example.org/' },
      { text: ' after' },
    ]);
  });

  it('is one plain piece when there is no link', () => {
    expect(splitLinks('just words')).toEqual([{ text: 'just words' }]);
  });

  it('starts and ends with a link without empty pieces around it', () => {
    expect(splitLinks('https://example.com')).toEqual([{ text: 'https://example.com', href: 'https://example.com/' }]);
  });

  it('has nothing for no text', () => {
    expect(splitLinks('')).toEqual([]);
  });

  it('keeps markup as plain text', () => {
    const [segment] = splitLinks('<script>alert(1)</script>');

    expect(segment).toEqual({ text: '<script>alert(1)</script>' });
  });
});

describe('withoutFragment', () => {
  it('drops the part after the hash', () => {
    expect(withoutFragment('https://example.com/a?b=1#top')).toBe('https://example.com/a?b=1');
  });

  it('leaves an address with no fragment as the URL parser writes it', () => {
    expect(withoutFragment('https://example.com')).toBe('https://example.com/');
  });

  it('has nothing for something that is not an address', () => {
    expect(withoutFragment('not a url')).toBeNull();
  });
});
