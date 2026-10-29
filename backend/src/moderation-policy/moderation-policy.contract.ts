import { z } from 'zod';
import {
  MODERATION_POLICY_RISK_LEVELS,
  MODERATION_POLICY_SIGNALS,
  MODERATION_POLICY_VERSION_V1,
  type ModerationPolicyOutput,
  type ModerationPolicyInput,
} from './moderation-policy.types';

export const moderationPolicyOutputSchema = z.strictObject({
  policyVersion: z.literal(MODERATION_POLICY_VERSION_V1),
  riskLevel: z.enum(MODERATION_POLICY_RISK_LEVELS),
  priorityScore: z.number().int().min(0).max(100),
  signals: z
    .array(z.enum(MODERATION_POLICY_SIGNALS))
    .max(MODERATION_POLICY_SIGNALS.length)
    .refine((signals) => new Set(signals).size === signals.length, {
      message: 'Duplicate moderation policy signal',
    }),
});

export function parseModerationPolicyOutput(
  raw: unknown,
): ModerationPolicyOutput {
  return moderationPolicyOutputSchema.parse(raw);
}

const storedOutputSchema = z.object({
  output: z.strictObject({
    model: z.strictObject({ name: z.string(), revision: z.string() }),
    labels: z
      .array(
        z.strictObject({
          label: z.string(),
          score: z.number().finite().min(0).max(1),
        }),
      )
      .min(1)
      .max(32)
      .refine(
        (labels) =>
          new Set(labels.map((entry) => entry.label)).size === labels.length,
      ),
  }),
});

/** Pure persisted-result parsing shared by policy execution and advisory reads. */
export function parsePersistedPolicyInput(
  classifierProfile: string,
  result: unknown,
): ModerationPolicyInput {
  const parsed = storedOutputSchema.parse(result);
  return {
    classifier: {
      profile: classifierProfile,
      model: parsed.output.model,
      labels: Object.fromEntries(
        parsed.output.labels.map(({ label, score }) => [label, score]),
      ),
    },
  };
}
