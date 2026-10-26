import { createHash } from 'node:crypto';
import type { ReportTargetSnapshot } from '../reports/domain/report-target-snapshot';

export const TEXT_INPUT_SCHEMA_VERSION = 1;
export const TEXT_CLASSIFIER_PROFILE = 'moderation-text-v1';
export const MAX_ANALYSIS_TITLE_LENGTH = 300;
export const MAX_ANALYSIS_CONTENT_LENGTH = 20_000;

// Version 1: NFC, CRLF/CR -> LF, trim edges, then truncate by Unicode code
// points. Interior whitespace is preserved. Bounds define the analyzed prefix;
// changes beyond it intentionally do not schedule another analysis.
export function normalizeAnalysisText(value: string, limit: number): string {
  return Array.from(value.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .slice(0, limit)
    .join('');
}

export function canonicalTextInput(snapshot: ReportTargetSnapshot) {
  const content = normalizeAnalysisText(
    snapshot.content,
    MAX_ANALYSIS_CONTENT_LENGTH,
  );
  const inputSnapshot =
    snapshot.targetType === 'POST'
      ? {
          type: 'POST' as const,
          title:
            normalizeAnalysisText(snapshot.title, MAX_ANALYSIS_TITLE_LENGTH) ||
            null,
          content,
        }
      : { type: 'COMMENT' as const, content };

  return {
    inputSchemaVersion: TEXT_INPUT_SCHEMA_VERSION,
    inputSnapshot,
    snapshotHash: hashTextInput(inputSnapshot),
  };
}

export function hashTextInput(
  input:
    | { type: 'POST'; title: string | null; content: string }
    | { type: 'COMMENT'; content: string },
): string {
  // Rebuild in canonical order; never depend on a JSONB object's key order.
  const inputSnapshot =
    input.type === 'POST'
      ? { type: input.type, title: input.title, content: input.content }
      : { type: input.type, content: input.content };
  // UTF-8 compact JSON, fixed insertion order: inputSchemaVersion, input;
  // POST keys: type,title,content; COMMENT keys: type,content. No trailing LF.
  const serialized = JSON.stringify({
    inputSchemaVersion: TEXT_INPUT_SCHEMA_VERSION,
    input: inputSnapshot,
  });
  return `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
}
