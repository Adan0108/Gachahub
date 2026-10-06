// Control, zero-width and direction-override characters (tab, newline and return are left for whitespace collapsing).
const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const isInvisible = (codePoint: number) =>
  INVISIBLE_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to);

/** One tidy line of text from someone else: invisible and direction-changing characters removed, whitespace collapsed, cut to `max`. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;

  const visible = Array.from(value)
    .filter((char) => !isInvisible(char.codePointAt(0) ?? 0))
    .join('');
  const text = visible.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return undefined;
  if (text.length <= max) return text;

  return `${text.slice(0, max - 1).trimEnd()}…`;
}
