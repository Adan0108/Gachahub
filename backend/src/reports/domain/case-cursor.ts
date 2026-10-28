export interface CaseCursor {
  id: string;
  lastReportedAt: Date;
}

export function encodeCaseCursor(cursor: CaseCursor): string {
  return Buffer.from(
    JSON.stringify({
      order: 'lastReportedAt',
      id: cursor.id,
      lastReportedAt: cursor.lastReportedAt.toISOString(),
    }),
  ).toString('base64url');
}

export function decodeCaseCursor(value: string): CaseCursor | null {
  try {
    if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value))
      return null;
    const data: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      !data ||
      typeof data !== 'object' ||
      !('order' in data) ||
      data.order !== 'lastReportedAt' ||
      !('id' in data) ||
      typeof data.id !== 'string' ||
      !data.id ||
      data.id.length > 200 ||
      !('lastReportedAt' in data) ||
      typeof data.lastReportedAt !== 'string'
    )
      return null;
    const lastReportedAt = new Date(data.lastReportedAt);
    if (
      !Number.isFinite(lastReportedAt.getTime()) ||
      lastReportedAt.toISOString() !== data.lastReportedAt
    )
      return null;
    return { id: data.id, lastReportedAt };
  } catch {
    return null;
  }
}
