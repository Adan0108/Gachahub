import { canonicalTextInput } from '../../moderation-analysis/canonical-text-input';
import { getModerationPolicyClassifierProfile } from '../../moderation-policy/moderation-policy.profiles';
import { projectAiAdvisory, type AdvisoryAnalysisRow } from './ai-advisory';

const item = {
  id: 'case',
  targetType: 'POST' as const,
  targetId: 'post',
  status: 'OPEN',
};
const source = {
  targetType: 'POST' as const,
  title: 'Tiêu đề',
  content: 'Cảm ơn bạn 😀\nHello',
};
const target = { targetState: 'available', source };
const canonical = canonicalTextInput(source);
const profile = getModerationPolicyClassifierProfile(
  'toxicity-mmbert-small-v1',
)!;
function analysis(
  change: Partial<AdvisoryAnalysisRow> = {},
): AdvisoryAnalysisRow {
  return {
    caseId: item.id,
    analysisId: 'analysis',
    generation: 2,
    analysisTargetType: item.targetType,
    analysisTargetId: item.targetId,
    inputSchemaVersion: 1,
    inputSnapshot: canonical.inputSnapshot,
    snapshotHash: canonical.snapshotHash,
    classifierProfile: profile.profile,
    analysisStatus: 'SUCCEEDED',
    result: {
      output: {
        model: profile.model,
        labels: profile.labels.map((label) => ({ label, score: 0.1 })),
      },
    },
    policyVersion: 'moderation-policy-v1',
    policyStatus: 'SUCCEEDED',
    riskLevel: 'MEDIUM',
    priorityScore: 40,
    signals: ['POSSIBLE_THREAT', 'CONTEXT_REVIEW_REQUIRED'],
    evaluatedAt: new Date('2026-10-29T00:00:00Z'),
    ...change,
  };
}

describe('pure case AI advisory', () => {
  it('returns the exact compact CURRENT contract and no private evidence', () => {
    expect(projectAiAdvisory(item, target, analysis())).toEqual({
      state: 'CURRENT',
      analysisGeneration: 2,
      policyVersion: 'moderation-policy-v1',
      riskLevel: 'MEDIUM',
      priorityScore: 40,
      signals: ['POSSIBLE_THREAT', 'CONTEXT_REVIEW_REQUIRED'],
      evaluatedAt: '2026-10-29T00:00:00.000Z',
    });
  });
  it.each(['RESOLVED', 'DISMISSED'])(
    'closed %s overrides availability, freshness and work',
    (status) => {
      expect(
        projectAiAdvisory(
          { ...item, status },
          { targetState: 'missing', source: null },
          analysis({ generation: null }),
        ),
      ).toEqual({ state: 'CASE_CLOSED' });
    },
  );
  it.each(['missing', 'deleted'])(
    'target %s overrides missing or failed analysis',
    (targetState) => {
      expect(
        projectAiAdvisory(
          item,
          { targetState, source: null },
          analysis({ analysisStatus: 'FAILED' }),
        ),
      ).toEqual({ state: 'TARGET_UNAVAILABLE', analysisGeneration: 2 });
    },
  );
  it('returns NO_ANALYSIS without fabricated generation/scores', () => {
    expect(projectAiAdvisory(item, target)).toEqual({ state: 'NO_ANALYSIS' });
  });
  it.each(['PENDING', 'FAILED', 'SUCCEEDED'])(
    'content mismatch precedes %s and malformed classifier evidence',
    (analysisStatus) => {
      expect(
        projectAiAdvisory(
          item,
          { ...target, source: { ...source, content: 'edited' } },
          analysis({ analysisStatus, result: null }),
        ),
      ).toEqual({ state: 'CONTENT_CHANGED', analysisGeneration: 2 });
    },
  );
  it.each([
    ['PENDING', 'ANALYSIS_PENDING'],
    ['FAILED', 'ANALYSIS_FAILED'],
  ])('highest candidate %s never falls back', (analysisStatus, state) => {
    expect(
      projectAiAdvisory(item, target, analysis({ analysisStatus })),
    ).toEqual({ state, analysisGeneration: 2 });
  });
  it('normalization-equivalent current content is CURRENT with the shared helper', () => {
    const equivalent = {
      ...source,
      title: '  ' + source.title.normalize('NFD') + ' ',
      content:
        '\t' + source.content.normalize('NFD').replace(/\n/g, '\r\n') + '\n ',
    };
    expect(
      projectAiAdvisory(item, { ...target, source: equivalent }, analysis())
        .state,
    ).toBe('CURRENT');
  });
  it.each([
    { inputSchemaVersion: 2 },
    { inputSnapshot: null },
    { snapshotHash: 'bad' },
    { generation: 0 },
    { generation: NaN },
    { analysisTargetId: 'other' },
    { caseId: 'other' },
    { analysisTargetType: 'COMMENT' },
    { analysisStatus: 'UNKNOWN' },
    { policyStatus: 'UNKNOWN' },
    { evaluatedAt: null },
    { evaluatedAt: new Date(NaN) },
    { priorityScore: 101 },
    { riskLevel: 'OTHER' },
    { signals: ['UNKNOWN'] },
    { signals: ['POSSIBLE_THREAT', 'POSSIBLE_THREAT'] },
  ] as Partial<AdvisoryAnalysisRow>[])(
    'invalid metadata/output fails closed: %j',
    (change) => {
      const result = projectAiAdvisory(item, target, analysis(change));
      expect(result.state).toBe('FRESHNESS_UNVERIFIED');
      expect(result).not.toHaveProperty('riskLevel');
      expect(result).not.toHaveProperty('signals');
      expect(result).not.toHaveProperty('priorityScore');
    },
  );
  it.each([
    { classifierProfile: 'moderation-text-v1' },
    { result: null },
    {
      result: {
        output: { model: { ...profile.model, revision: 'main' }, labels: [] },
      },
    },
    {
      result: {
        output: {
          model: { ...profile.model, name: 'other/model' },
          labels: [],
        },
      },
    },
    {
      result: {
        output: {
          model: profile.model,
          labels: [{ label: 'threat', score: NaN }],
        },
      },
    },
    {
      result: {
        output: {
          model: profile.model,
          labels: [{ label: 'unexpected', score: 0.5 }],
        },
      },
    },
    { policyStatus: 'UNSUPPORTED' },
  ])(
    'unsupported classifier/policy evidence never becomes current: %j',
    (change) => {
      expect(projectAiAdvisory(item, target, analysis(change))).toEqual({
        state: 'UNSUPPORTED_EVIDENCE',
        analysisGeneration: 2,
      });
    },
  );
  it.each([
    { policyStatus: null, policyVersion: null },
    { policyStatus: 'PENDING' },
    { policyVersion: 'moderation-policy-old', policyStatus: 'SUCCEEDED' },
  ])('missing/pending active version: %j', (change) => {
    expect(projectAiAdvisory(item, target, analysis(change))).toEqual({
      state: 'POLICY_PENDING',
      analysisGeneration: 2,
    });
  });
  it('does not expose stale policy output on FAILED', () => {
    expect(
      projectAiAdvisory(item, target, analysis({ policyStatus: 'FAILED' })),
    ).toEqual({ state: 'POLICY_FAILED', analysisGeneration: 2 });
  });
  it('cannot prove freshness without current text', () => {
    expect(
      projectAiAdvisory(
        item,
        { targetState: 'available', source: null },
        analysis(),
      ).state,
    ).toBe('FRESHNESS_UNVERIFIED');
  });
});
