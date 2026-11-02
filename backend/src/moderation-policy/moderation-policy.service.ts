import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { parseModerationPolicyOutput } from './moderation-policy.contract';
import { isSupportedPolicyClassifierEvidence } from './moderation-policy.profiles';
import { evaluateModerationPolicyRules } from './moderation-policy.rules';
import type {
  ModerationPolicyInput,
  ModerationPolicyOutput,
} from './moderation-policy.types';

const classifierSchema = z.strictObject({
  profile: z.string(),
  model: z.strictObject({ name: z.string(), revision: z.string() }),
  labels: z.record(z.string(), z.number().finite().min(0).max(1)),
});
// Deliberately parse classifier only. Optional context is ignored by v1.
const inputSchema = z.object({ classifier: classifierSchema });

export class UnsupportedModerationPolicyEvidenceError extends Error {
  readonly code = 'UNSUPPORTED_CLASSIFIER_EVIDENCE';
  constructor() {
    super('Unsupported moderation policy classifier evidence');
    this.name = 'UnsupportedModerationPolicyEvidenceError';
  }
}

@Injectable()
export class ModerationPolicyService {
  evaluate(input: ModerationPolicyInput): ModerationPolicyOutput {
    const parsed = inputSchema.safeParse(input);
    if (
      !parsed.success ||
      !isSupportedPolicyClassifierEvidence(parsed.data.classifier)
    ) {
      throw new UnsupportedModerationPolicyEvidenceError();
    }
    return parseModerationPolicyOutput(
      evaluateModerationPolicyRules(parsed.data.classifier.labels),
    );
  }
}
