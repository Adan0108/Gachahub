import { randomUUID } from 'node:crypto';
import type { ModerationResultEvent } from '../../src/moderation-analysis/moderation-result.contract';

export function resultFixture(analysis: {
  id: string;
  caseId: string;
  generation: number;
  snapshotHash: string;
  classifierProfile: string;
}): ModerationResultEvent {
  return {
    eventId: randomUUID(),
    type: 'moderation.result',
    version: 1,
    occurredAt: '2026-10-22T00:00:00Z',
    aggregateId: analysis.caseId,
    payload: {
      analysisJobId: analysis.id,
      caseId: analysis.caseId,
      generation: analysis.generation,
      snapshotHash: analysis.snapshotHash,
      classifierProfile: analysis.classifierProfile,
      status: 'SUCCEEDED',
      completedAt: '2026-10-22T00:00:00Z',
      output: {
        model: { name: 'deterministic-fixture', revision: '1' },
        labels: [{ label: 'safe', score: 0.75 }],
      },
    },
  };
}
