import { z } from 'zod';
import {
  MODERATION_POLICY_RISK_LEVELS,
  MODERATION_POLICY_SIGNALS,
  MODERATION_POLICY_VERSION_V1,
  type ModerationPolicyOutput,
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
