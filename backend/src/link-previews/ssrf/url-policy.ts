import { isIP } from 'node:net';
import { isPublicAddress } from './ip-policy';

export class UnsafeUrlError extends Error {}

const MAX_URL_LENGTH = 2048;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const INTERNAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.corp',
  '.home.arpa',
];

/**
 * Parses a link a user wants previewed and refuses anything that is not a plain public web address:
 * other schemes, credentials, unusual ports, internal names, and IP literals in any encoding
 * (the URL parser turns decimal, octal and hex forms into dotted quads before they get here).
 * The fragment is dropped; it never reaches a server anyway.
 */
export function parsePublicHttpUrl(raw: string): URL {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_URL_LENGTH
  ) {
    throw new UnsafeUrlError('Not a usable link');
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('Not a usable link');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https links');
  }
  if (url.username !== '' || url.password !== '') {
    throw new UnsafeUrlError('Links with credentials');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError('Unusual port');
  }

  const host = url.hostname.startsWith('[')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  if (isIP(host) !== 0) {
    if (!isPublicAddress(host)) throw new UnsafeUrlError('Non-public address');
  } else {
    const name = host.endsWith('.') ? host.slice(0, -1) : host;
    const isInternalName =
      name === 'localhost' ||
      !name.includes('.') ||
      INTERNAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
    if (isInternalName) throw new UnsafeUrlError('Internal name');
  }

  url.hash = '';
  return url;
}
