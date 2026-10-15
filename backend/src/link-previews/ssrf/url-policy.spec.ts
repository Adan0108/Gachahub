import { parsePublicHttpUrl, UnsafeUrlError } from './url-policy';

describe('parsePublicHttpUrl', () => {
  it('accepts an ordinary public link and drops the fragment', () => {
    const url = parsePublicHttpUrl('https://example.com/a/b?x=1#section');

    expect(url.href).toBe('https://example.com/a/b?x=1');
  });

  it.each([
    ['http://example.com'],
    ['https://example.com:443/x'],
    ['http://example.com:80/x'],
    ['https://sub.example.co.uk/path'],
    ['https://8.8.8.8/'],
    ['https://[2606:4700:4700::1111]/'],
    ['  https://example.com/padded  '],
    ['https://xn--bcher-kva.example/'],
  ])('accepts %s', (raw) => {
    expect(() => parsePublicHttpUrl(raw)).not.toThrow();
  });

  it.each([
    ['file:///etc/passwd'],
    ['ftp://example.com/file'],
    ['gopher://example.com/'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['ws://example.com/'],
  ])('refuses the scheme in %s', (raw) => {
    expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
  });

  it.each([
    ['https://user@example.com/'],
    ['https://user:pass@example.com/'],
    ['https://:pass@example.com/'],
  ])('refuses credentials in %s', (raw) => {
    expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
  });

  it.each([
    ['http://example.com:8080/'],
    ['https://example.com:22/'],
    ['https://example.com:6379/'],
    ['http://example.com:443/x', false],
  ])('refuses the port in %s', (raw, shouldThrow = true) => {
    if (shouldThrow) {
      expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
    } else {
      expect(() => parsePublicHttpUrl(raw)).not.toThrow();
    }
  });

  it.each([
    ['http://localhost/'],
    ['http://LOCALHOST/'],
    ['http://localhost./'],
    ['http://foo.localhost/'],
    ['http://printer.local/'],
    ['http://db.internal/'],
    ['http://router.lan/'],
    ['http://nas.home.arpa/'],
    ['http://intranet/'],
    ['http://metadata/'],
  ])('refuses the internal name in %s', (raw) => {
    expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
  });

  it.each([
    ['http://127.0.0.1/'],
    ['http://127.1/'],
    ['http://0.0.0.0/'],
    ['http://10.0.0.5/admin'],
    ['http://192.168.1.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://[::1]/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://[fd00::1]/'],
    ['http://[fe80::1]/'],
  ])('refuses the non-public address in %s', (raw) => {
    expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
  });

  it.each([
    ['decimal', 'http://2130706433/'],
    ['hex', 'http://0x7f000001/'],
    ['octal', 'http://017700000001/'],
    ['dotted octal', 'http://0177.0.0.1/'],
    ['dotted hex', 'http://0x7f.0x0.0x0.0x1/'],
    ['short form', 'http://127.1/'],
    ['metadata in decimal', 'http://2852039166/'],
    ['mixed', 'http://0x7f.1/'],
  ])('sees through the %s encoding of an internal address', (_name, raw) => {
    expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
  });

  it.each([
    [''],
    ['not a url'],
    ['://nothing'],
    ['http://'],
    ['https:///path'],
  ])('refuses the unparseable %p', (raw) => {
    expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
  });

  it('refuses an overlong link', () => {
    expect(() =>
      parsePublicHttpUrl(`https://example.com/${'a'.repeat(2100)}`),
    ).toThrow(UnsafeUrlError);
  });

  it('refuses something that is not a string', () => {
    expect(() => parsePublicHttpUrl(undefined as unknown as string)).toThrow(
      UnsafeUrlError,
    );
    expect(() => parsePublicHttpUrl(42 as unknown as string)).toThrow(
      UnsafeUrlError,
    );
  });
});
