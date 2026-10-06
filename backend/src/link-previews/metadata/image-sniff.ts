export type PreviewImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

/**
 * The picture format by its first bytes, never by what the server claimed.
 * SVG is deliberately absent: it can carry script, and the thumbnail is shown to other people.
 */
export function sniffImageMime(bytes: Uint8Array): PreviewImageMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'image/gif';
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
}
