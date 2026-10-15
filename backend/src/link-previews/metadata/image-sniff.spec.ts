import { sniffImageMime } from './image-sniff';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));

describe('sniffImageMime', () => {
  it('recognises the formats a thumbnail may be', () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe(
      'image/jpeg',
    );
    expect(
      sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toBe('image/png');
    expect(sniffImageMime(ascii('GIF89a\x01\x00'))).toBe('image/gif');
    expect(sniffImageMime(ascii('GIF87a\x01\x00'))).toBe('image/gif');
    expect(sniffImageMime(ascii('RIFF\x24\x00\x00\x00WEBPVP8 '))).toBe(
      'image/webp',
    );
  });

  it.each([
    [
      'SVG',
      ascii(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    ],
    ['SVG with a prolog', ascii('<?xml version="1.0"?><svg></svg>')],
    ['HTML', ascii('<!doctype html><html></html>')],
    ['a script', ascii('#!/bin/sh\nrm -rf /')],
    [
      'a WAV file, which shares the RIFF header',
      ascii('RIFF\x24\x00\x00\x00WAVEfmt '),
    ],
    ['an empty file', bytes()],
    ['a truncated PNG header', bytes(0x89, 0x50, 0x4e)],
    ['a GIF with the wrong version', ascii('GIF90a')],
  ])('refuses %s', (_name, content) => {
    expect(sniffImageMime(content)).toBeNull();
  });
});
