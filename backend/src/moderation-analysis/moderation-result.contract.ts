import { z } from 'zod';

const MAX_EVENT_BYTES = 32 * 1024;

const moderationLabelSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i),

  score: z.number().finite().min(0).max(1),
});

const modelIdentitySchema = z.strictObject({
  // JSON permits escaped NUL/unpaired surrogates, but PostgreSQL JSONB rejects
  // them. Reject at the boundary so such input cannot poison Kafka retries.
  name: z.string().trim().min(1).max(128).refine(isJsonbText),
  revision: z.string().trim().min(1).max(256).refine(isJsonbText),
});

function isJsonbText(value: string): boolean {
  return !value.includes('\0') && !/\p{Surrogate}/u.test(value);
}

const successPayloadSchema = z.strictObject({
  analysisJobId: z.string().min(1).max(128).refine(isJsonbText),
  caseId: z.string().min(1).max(128).refine(isJsonbText),

  generation: z.number().int().positive().max(2147483647),

  snapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),

  classifierProfile: z.string().trim().min(1).max(128).refine(isJsonbText),

  status: z.literal('SUCCEEDED'),

  completedAt: z.string().datetime({ offset: true }),

  output: z.strictObject({
    model: modelIdentitySchema,

    labels: z
      .array(moderationLabelSchema)
      .min(1)
      .max(32)
      .superRefine((labels, ctx) => {
        const seen = new Set<string>();

        labels.forEach((entry, index) => {
          const normalized = entry.label.toLowerCase();

          if (seen.has(normalized)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, 'label'],
              message: 'Duplicate moderation label',
            });
          }

          seen.add(normalized);
        });
      }),
  }),
});

const failurePayloadSchema = z.strictObject({
  analysisJobId: z.string().min(1).max(128).refine(isJsonbText),
  caseId: z.string().min(1).max(128).refine(isJsonbText),

  generation: z.number().int().positive().max(2147483647),

  snapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),

  classifierProfile: z.string().trim().min(1).max(128).refine(isJsonbText),

  status: z.literal('FAILED'),

  completedAt: z.string().datetime({ offset: true }),

  // Deliberately bounded machine-readable code.
  // Do not send stack traces/free-form model errors through Kafka.
  errorCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9_]+$/),
});

const payloadSchema = z.discriminatedUnion('status', [
  successPayloadSchema,
  failurePayloadSchema,
]);

const envelopeSchema = z
  .strictObject({
    eventId: z.string().uuid(),

    type: z.literal('moderation.result'),

    version: z.literal(1),

    occurredAt: z.string().datetime({ offset: true }),

    aggregateId: z.string().min(1).max(128).refine(isJsonbText),

    payload: payloadSchema,
  })
  .superRefine((event, ctx) => {
    if (event.aggregateId !== event.payload.caseId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aggregateId'],
        message: 'aggregateId must equal payload.caseId',
      });
    }
  });

export type ModerationResultEvent = z.infer<typeof envelopeSchema>;

export type ModerationResultPayload = ModerationResultEvent['payload'];

export function parseModerationResultEvent(
  raw: unknown,
): ModerationResultEvent {
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);

  if (serialized === undefined) throw new Error('Invalid moderation result');

  if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_BYTES) {
    throw new Error('Moderation result exceeds maximum event size');
  }

  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Invalid moderation result JSON');
    }
  }

  return envelopeSchema.parse(parsed);
}

export function toStoredModerationResult(event: ModerationResultEvent) {
  const { payload } = event;

  if (payload.status === 'SUCCEEDED') {
    return {
      acceptedEventId: event.eventId,
      completedAt: payload.completedAt,

      output: {
        model: {
          name: payload.output.model.name,
          revision: payload.output.model.revision,
        },
        labels: payload.output.labels.map((label) => ({
          label: label.label,
          score: label.score,
        })),
      },
    };
  }

  return {
    acceptedEventId: event.eventId,
    completedAt: payload.completedAt,
    errorCode: payload.errorCode,
  };
}
