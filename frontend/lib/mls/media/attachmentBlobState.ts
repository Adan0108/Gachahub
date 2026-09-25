import type { AttachmentSource } from './attachmentLoader';

export type AttachmentBlobState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

/** The last load result, tagged with the exact source it belongs to. */
export interface SettledLoad {
  cacheKey: string;
  url: string;
  outcome: { url: string } | { message: string };
}

/** Status shown for a source: a settled result only counts while it still matches cacheKey and url. */
export function deriveBlobState(
  settled: SettledLoad | null,
  source: AttachmentSource | null,
  enabled: boolean,
): AttachmentBlobState {
  if (!enabled || !source) return { status: 'idle' };
  if (!settled || settled.cacheKey !== source.cacheKey || settled.url !== source.url) {
    return { status: 'loading' };
  }
  return 'url' in settled.outcome
    ? { status: 'ready', url: settled.outcome.url }
    : { status: 'error', message: settled.outcome.message };
}
