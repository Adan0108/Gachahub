import {
  parseModerationResultEvent,
  toStoredModerationResult,
} from './moderation-result.contract';

function fixture() {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    type: 'moderation.result',
    version: 1,
    aggregateId: 'case',
    occurredAt: '2026-10-22T00:00:00Z',
    payload: {
      analysisJobId: 'job',
      caseId: 'case',
      generation: 1,
      snapshotHash: `sha256:${'a'.repeat(64)}`,
      classifierProfile: 'moderation-text-v1',
      status: 'SUCCEEDED',
      completedAt: '2026-10-22T00:00:00Z',
      output: {
        model: { name: 'fixture', revision: '1' },
        labels: [{ label: 'safe', score: 0.8 }],
      },
    },
  };
}

describe('moderation.result contract', () => {
  it('rejects a job identifier containing NUL before it can reach a PostgreSQL parameter', () => {
    const event = fixture();
    event.payload.analysisJobId = 'job\0id';
    expect(() => parseModerationResultEvent(JSON.stringify(event))).toThrow();
  });
  it.each(['bad\0name', '\ud800', '\udfff'])(
    'rejects model text PostgreSQL JSONB cannot store %#',
    (name) => {
      const event = fixture();
      event.payload.output.model.name = name;
      expect(() => parseModerationResultEvent(JSON.stringify(event))).toThrow();
      event.payload.output.model.name = 'fixture';
      event.payload.output.model.revision = name;
      expect(() => parseModerationResultEvent(JSON.stringify(event))).toThrow();
    },
  );
  it('accepts valid paired Unicode in model identity', () => {
    const event = fixture();
    event.payload.output.model.name = 'model-😀';
    expect(
      parseModerationResultEvent(JSON.stringify(event)).payload.status,
    ).toBe('SUCCEEDED');
  });
  it('accepts exactly 32 KiB and rejects one byte more', () => {
    const raw = JSON.stringify(fixture());
    const bounded = raw + ' '.repeat(32768 - Buffer.byteLength(raw, 'utf8'));
    expect(parseModerationResultEvent(bounded).type).toBe('moderation.result');
    expect(() => parseModerationResultEvent(bounded + ' ')).toThrow();
  });
  it('accepts success and persists only normalized evidence', () => {
    const event = parseModerationResultEvent(JSON.stringify(fixture()));
    expect(toStoredModerationResult(event)).toEqual({
      acceptedEventId: event.eventId,
      completedAt: event.payload.completedAt,
      output: fixture().payload.output,
    });
  });
  it('accepts bounded machine failure', () => {
    const raw = fixture();
    const { output: _output, ...identity } = raw.payload;
    const event = parseModerationResultEvent({
      ...raw,
      payload: { ...identity, status: 'FAILED', errorCode: 'MODEL_TIMEOUT' },
    });
    expect(toStoredModerationResult(event)).toEqual({
      acceptedEventId: event.eventId,
      completedAt: identity.completedAt,
      errorCode: 'MODEL_TIMEOUT',
    });
  });
  it.each([
    [
      'version',
      (e: ReturnType<typeof fixture>) => {
        e.version = 2;
      },
    ],
    [
      'type',
      (e: ReturnType<typeof fixture>) => {
        e.type = 'other';
      },
    ],
    [
      'aggregate',
      (e: ReturnType<typeof fixture>) => {
        e.aggregateId = 'other';
      },
    ],
    [
      'UUID',
      (e: ReturnType<typeof fixture>) => {
        e.eventId = 'not-uuid';
      },
    ],
    [
      'generation',
      (e: ReturnType<typeof fixture>) => {
        e.payload.generation = 0;
      },
    ],
    [
      'large generation',
      (e: ReturnType<typeof fixture>) => {
        e.payload.generation = 2147483648;
      },
    ],
    [
      'hash',
      (e: ReturnType<typeof fixture>) => {
        e.payload.snapshotHash = 'bad';
      },
    ],
    [
      'profile',
      (e: ReturnType<typeof fixture>) => {
        e.payload.classifierProfile = 'x'.repeat(129);
      },
    ],
    [
      'PARTIAL',
      (e: ReturnType<typeof fixture>) => {
        e.payload.status = 'PARTIAL';
      },
    ],
    [
      'score',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.labels[0].score = 1.1;
      },
    ],
    [
      'infinite',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.labels[0].score = Infinity;
      },
    ],
    [
      'NaN',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.labels[0].score = NaN;
      },
    ],
    [
      'negative',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.labels[0].score = -0.1;
      },
    ],
    [
      'duplicate labels',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.labels.push({ label: 'SAFE', score: 0 });
      },
    ],
    [
      'empty labels',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.labels = [];
      },
    ],
    [
      'many labels',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.labels = Array.from({ length: 33 }, (_, i) => ({
          label: `label${i}`,
          score: 0,
        }));
      },
    ],
    [
      'model',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.model.name = 'x'.repeat(129);
      },
    ],
    [
      'revision',
      (e: ReturnType<typeof fixture>) => {
        e.payload.output.model.revision = 'x'.repeat(257);
      },
    ],
  ])('rejects invalid %s', (_name, mutate) => {
    const event = fixture();
    mutate(event);
    expect(() => parseModerationResultEvent(event)).toThrow();
  });
  it.each([
    undefined,
    null,
    '{',
    ' '.repeat(32769),
    { ...fixture(), extra: 'content' },
    {
      ...fixture(),
      payload: { ...fixture().payload, errorDetails: 'private' },
    },
    { ...fixture(), payload: { ...fixture().payload, output: undefined } },
    {
      ...fixture(),
      payload: {
        ...fixture().payload,
        output: { ...fixture().payload.output, extra: true },
      },
    },
    {
      ...fixture(),
      payload: {
        ...fixture().payload,
        output: {
          model: { ...fixture().payload.output.model, extra: true },
          labels: [{ label: 'safe', score: 0, extra: true }],
        },
      },
    },
    {
      ...fixture(),
      payload: { ...fixture().payload, status: 'FAILED', output: undefined },
    },
    {
      ...fixture(),
      payload: {
        ...fixture().payload,
        status: 'FAILED',
        output: undefined,
        errorCode: 'free form error',
      },
    },
  ])('rejects malformed, oversized, missing or unexpected data %#', (raw) => {
    expect(() => parseModerationResultEvent(raw)).toThrow();
  });
});
