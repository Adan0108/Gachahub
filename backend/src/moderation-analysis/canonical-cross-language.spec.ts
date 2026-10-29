import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalTextInput, hashTextInput } from './canonical-text-input';
import type { ReportTargetSnapshot } from '../reports/domain/report-target-snapshot';

const vectors = [
  'canonical-text-v1.json',
  'canonical-text-health-v1.json',
].flatMap(
  (filename) =>
    JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../moderation-worker/tests/fixtures',
          filename,
        ),
        'utf8',
      ),
    ) as Array<{
      name: string;
      source: {
        type: 'POST' | 'COMMENT';
        title?: string | null;
        content: string;
      };
      input: Parameters<typeof hashTextInput>[0];
      serialized: string;
      snapshotHash: string;
    }>,
);
describe('shared TypeScript/Python canonical fingerprint vectors', () => {
  it.each(vectors)('$name', (vector) => {
    const snapshot = {
      targetType: vector.source.type,
      title: vector.source.title ?? '',
      content: vector.source.content,
    } as ReportTargetSnapshot;
    const computed = canonicalTextInput(snapshot);
    expect(computed.inputSnapshot).toEqual(vector.input);
    expect(computed.snapshotHash).toBe(vector.snapshotHash);
    expect(
      JSON.stringify({ inputSchemaVersion: 1, input: computed.inputSnapshot }),
    ).toBe(vector.serialized);
    // JSONB may reorder properties on retrieval.
    const reordered =
      vector.input.type === 'POST'
        ? {
            content: vector.input.content,
            title: vector.input.title,
            type: 'POST' as const,
          }
        : { content: vector.input.content, type: 'COMMENT' as const };
    expect(hashTextInput(reordered)).toBe(vector.snapshotHash);
  });
});
