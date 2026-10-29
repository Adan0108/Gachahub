import { createHash } from 'node:crypto';
import { z } from 'zod';

export const TEXT_INPUT_SCHEMA_VERSION = 1;
export const TEXT_CLASSIFIER_PROFILE = 'moderation-text-v1';
export const HUGGINGFACE_TEXT_CLASSIFIER_PROFILE = 'toxicity-mmbert-small-v1';

export function configuredTextClassifierProfile(): string {
  const profile =
    process.env.MODERATION_CLASSIFIER_PROFILE ?? TEXT_CLASSIFIER_PROFILE;
  if (
    ![TEXT_CLASSIFIER_PROFILE, HUGGINGFACE_TEXT_CLASSIFIER_PROFILE].includes(
      profile,
    )
  ) {
    throw new Error('Unsupported MODERATION_CLASSIFIER_PROFILE');
  }
  return profile;
}
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

export type CanonicalTextSource =
  | { targetType: 'POST'; title: string; content: string }
  | { targetType: 'COMMENT'; content: string };

export function canonicalTextInput<T extends CanonicalTextSource>(snapshot: T) {
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

// Shared with immutable worker-input reads and advisory freshness validation.
function boundedText(limit: number) {
  return z
    .string()
    .max(limit * 2)
    .refine(
      (text) =>
        !text.includes('\0') &&
        !/\p{Surrogate}/u.test(text) &&
        Array.from(text).length <= limit &&
        (normalizeAnalysisText(text, limit) === text ||
          (Array.from(text).length === limit &&
            normalizeAnalysisText(text, limit) === text.trimEnd())),
    );
}

export const moderationInputSnapshotSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('POST'),
    title: boundedText(MAX_ANALYSIS_TITLE_LENGTH).min(1).nullable(),
    content: boundedText(MAX_ANALYSIS_CONTENT_LENGTH),
  }),
  z.strictObject({
    type: z.literal('COMMENT'),
    content: boundedText(MAX_ANALYSIS_CONTENT_LENGTH),
  }),
]);

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
