export interface EvidenceCursor {
  id: string;
  createdAt: Date;
}

export function encodeEvidenceCursor(cursor: EvidenceCursor): string {
  return Buffer.from(
    JSON.stringify({
      id: cursor.id,
      createdAt: cursor.createdAt.toISOString(),
    }),
  ).toString('base64url');
}

export function decodeEvidenceCursor(value: string): EvidenceCursor | null {
  try {
    if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value))
      return null;
    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      !('id' in decoded) ||
      !('createdAt' in decoded) ||
      typeof decoded.id !== 'string' ||
      !decoded.id ||
      decoded.id.length > 200 ||
      typeof decoded.createdAt !== 'string'
    )
      return null;
    const createdAt = new Date(decoded.createdAt);
    if (
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.toISOString() !== decoded.createdAt
    )
      return null;
    return { id: decoded.id, createdAt };
  } catch {
    return null;
  }
}
