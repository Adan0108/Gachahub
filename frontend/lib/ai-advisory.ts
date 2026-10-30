export const advisorySignals = {
  SEVERE_TOXICITY_HIGH_SCORE: {
    label: "Potentially severe hostile language",
    description:
      "Language may be especially hostile or abusive. Review who it addresses and the surrounding conversation.",
  },
  TOXICITY_WITH_INSULT: {
    label: "Potentially insulting or hostile language",
    description:
      "Wording may insult or demean someone. Check the tone and context before deciding.",
  },
  IDENTITY_ATTACK_POSSIBLE: {
    label: "Possible identity-based attack",
    description:
      "Wording may target a person or group based on identity. Check whether it is an attack, a quotation or a discussion.",
  },
  SEXUAL_CONTENT_POSSIBLE: {
    label: "Possible explicit sexual content",
    description:
      "Text may contain sexual language. Review its meaning and whether platform rules apply.",
  },
  PROFANITY_POSSIBLE: {
    label: "Possible strong profanity",
    description:
      "Strong language may be present. Profanity alone does not establish a rule violation.",
  },
  POSSIBLE_THREAT: {
    label: "Possible threatening language",
    description:
      "Wording may sound threatening. Distinguish a real threat from game combat, character dialogue or quoted text.",
  },
  CONTEXT_REVIEW_REQUIRED: {
    label: "Context needs human review",
    description:
      "Read the surrounding conversation. Fictional violence, lore, quotations and jokes can be misread by AI.",
  },
} as const;

export type AdvisorySignal = keyof typeof advisorySignals;
export type AdvisoryRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const advisoryStates = {
  CASE_CLOSED: [
    "Case closed",
    "AI findings are no longer presented for completed cases. Review the reports and moderation history for the decision.",
  ],
  TARGET_UNAVAILABLE: [
    "Content unavailable for AI review",
    "The content cannot currently be checked. You can still review the reported evidence.",
  ],
  NO_ANALYSIS: [
    "No AI assessment yet",
    "There is no AI assessment for this content. You can review the case using the reports and available context.",
  ],
  FRESHNESS_UNVERIFIED: [
    "AI assessment freshness unverified",
    "We cannot confirm that an assessment matches this content. Previous findings are hidden to avoid misleading your review.",
  ],
  CONTENT_CHANGED: [
    "Content changed since AI review",
    "The content was edited after it was reviewed. Previous findings do not describe the current content and are hidden.",
  ],
  ANALYSIS_PENDING: [
    "AI review in progress",
    "The latest content is awaiting AI review. Previous findings are hidden while this review is pending.",
  ],
  ANALYSIS_FAILED: [
    "AI review unavailable",
    "The latest AI review could not be completed. Previous findings are hidden. You can continue reviewing the reports yourself.",
  ],
  UNSUPPORTED_EVIDENCE: [
    "AI assessment unavailable for this content",
    "The available analysis cannot support an assessment. Use the reports and your own judgment to review this case.",
  ],
  POLICY_PENDING: [
    "Preparing AI assessment",
    "The analysis is awaiting assessment. Findings will appear when a current assessment is available.",
  ],
  POLICY_FAILED: [
    "AI assessment unavailable",
    "The assessment could not be completed. You can continue reviewing the reports and content yourself.",
  ],
} as const;

export type NonCurrentAdvisoryState = keyof typeof advisoryStates;
export type AiAdvisory =
  | {
      state: "CURRENT";
      analysisGeneration: number;
      policyVersion: "moderation-policy-v1";
      riskLevel: AdvisoryRisk;
      priorityScore: number;
      signals: AdvisorySignal[];
      evaluatedAt: string;
    }
  | { state: NonCurrentAdvisoryState; analysisGeneration?: number };

const owns = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** Validate the API boundary and copy only public fields; never recover historical findings. */
export function parseAiAdvisory(value: unknown): AiAdvisory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const generation = raw.analysisGeneration;
  const validGeneration =
    typeof generation === "number" &&
    Number.isInteger(generation) &&
    generation > 0 &&
    generation <= 2147483647;
  if (typeof raw.state !== "string") return null;
  if (owns(advisoryStates, raw.state)) {
    return {
      state: raw.state as NonCurrentAdvisoryState,
      ...(validGeneration ? { analysisGeneration: generation } : {}),
    };
  }
  if (
    raw.state !== "CURRENT" ||
    !validGeneration ||
    raw.policyVersion !== "moderation-policy-v1" ||
    !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(raw.riskLevel as string) ||
    typeof raw.priorityScore !== "number" ||
    !Number.isInteger(raw.priorityScore) ||
    raw.priorityScore < 0 ||
    raw.priorityScore > 100 ||
    !Array.isArray(raw.signals) ||
    raw.signals.length > Object.keys(advisorySignals).length ||
    !raw.signals.every((signal) => typeof signal === "string" && owns(advisorySignals, signal)) ||
    new Set(raw.signals).size !== raw.signals.length ||
    typeof raw.evaluatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.evaluatedAt) ||
    !Number.isFinite(Date.parse(raw.evaluatedAt))
  )
    return null;
  return {
    state: "CURRENT",
    analysisGeneration: generation as number,
    policyVersion: "moderation-policy-v1",
    riskLevel: raw.riskLevel as AdvisoryRisk,
    priorityScore: raw.priorityScore,
    signals: [...raw.signals] as AdvisorySignal[],
    evaluatedAt: raw.evaluatedAt,
  };
}
