const chars = (...codePoints: number[]) =>
  codePoints.map((codePoint) => String.fromCodePoint(codePoint)).join('');

// Control characters except tab and newline; PostgreSQL also refuses NUL in text.
const CONTROL_CHARS = new RegExp(
  `[${chars(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b, 0x0c)}${chars(0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x7f)}]`,
  'g',
);

// Zero-width space, word joiner, direction overrides and isolates, byte order mark: they can make text look like something else.
// ZWJ and ZWNJ stay, because emoji and some scripts need them.
const DISGUISING_CHARS = new RegExp(
  `[${chars(0x200b, 0x2060, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff)}]`,
  'g',
);

const BLANK_LINE_RUNS = /\n{4,}/g;

/** One message as it is stored: unified line breaks, no hidden or control characters, no run of blank lines, trimmed. */
export function cleanMessageContent(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(DISGUISING_CHARS, '')
    .replace(BLANK_LINE_RUNS, '\n\n\n')
    .trim();
}
