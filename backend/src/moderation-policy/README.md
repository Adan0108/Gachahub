# Moderation policy: Stage 2D.1 foundation and Stage 2D.2 pure rules

Stage 2D.1 defines schema/contracts and the production classifier registry.
Stage 2D.2 adds pure classifier-score to advisory mapping through
`ModerationPolicyService.evaluate(input)`. The module exports the service but is
not imported into result ingestion. Evaluation has no injected infrastructure,
database writes, network calls, clock, randomness, or environment lookup.

Not yet implemented: DB runner, retries, result-ingestion wiring, freshness API,
context/NLI model, or enforcement. No evaluation is triggered automatically.

## Provisional v1 rules

All thresholds are provisional engineering defaults, not production-calibrated
probabilities or certainty of a violation. Constants live in
`moderation-policy.rules.ts`:

| Signal                     | Inclusive threshold                 | Risk / priority            |
| -------------------------- | ----------------------------------- | -------------------------- |
| SEVERE_TOXICITY_HIGH_SCORE | severe_toxicity >= 0.90             | HIGH / 70                  |
| TOXICITY_WITH_INSULT       | toxicity >= 0.85 AND insult >= 0.80 | MEDIUM / 50                |
| IDENTITY_ATTACK_POSSIBLE   | identity_attack >= 0.85             | HIGH / 70                  |
| SEXUAL_CONTENT_POSSIBLE    | sexual_explicit >= 0.90             | MEDIUM / 40                |
| PROFANITY_POSSIBLE         | obscene >= 0.90                     | MEDIUM / 40                |
| POSSIBLE_THREAT            | threat >= 0.70                      | MEDIUM / 40                |
| CONTEXT_REVIEW_REQUIRED    | whenever POSSIBLE_THREAT fires      | caution; no extra priority |

No signals maps to LOW / 10. Multiple signals use the maximum applicable fixed
band, never a sum. CRITICAL is reserved and cannot be emitted by v1. Toxicity
alone does not escalate; threat plus toxicity remains MEDIUM unless an
independent HIGH rule fires. Signals follow `MODERATION_POLICY_SIGNALS` order.

The service validates runtime classifier shape, exact production compatibility,
finite bounded scores, then rules and the existing strict Zod output contract.
Unsupported/malformed evidence throws `UnsupportedModerationPolicyEvidenceError`
with fixed code `UNSUPPORTED_CLASSIFIER_EVIDENCE`; it never fabricates LOW.
Optional context is explicitly ignored by v1, not interpreted or persisted.
There are no keyword gaming exemptions. The fixed gaming regression uses
toxicity=0.74, threat=0.74 and other scores=0: MEDIUM / 40 with threat and context
caution. This is conservative score mapping, not gaming-context understanding.
Output contains no evaluatedAt; future persistence owns that timestamp.

## Foundation and persistence contract

`moderation-policy-v1` is the reserved immutable policy version. Risk values are
LOW/MEDIUM/HIGH/CRITICAL; accepting a value in the contract does not assign it.
Priority is an integer 0–100 for queue prioritization, not violation probability
or model confidence. Signals are the seven bounded, unique advisory codes in
`moderation-policy.types.ts`. No enforcement identifiers are accepted.

The readonly input contains classifier evidence and optional future context
evidence. Context has no selected model, database relation, or persisted blob.
The registry reuses the backend classifier profile identifier and pins its model,
revision and exact seven-label taxonomy. Fixture evidence is excluded. The
compatibility helper expects typed evidence parsed from persisted output; it is
not a replacement for ingestion's identity/hash checks or a raw JSON parser.

`ModerationPolicyEvaluation` belongs to an analysis, cascading on deletion.
`(analysisId, policyVersion)` is unique. Rows carry retry/lease metadata for future
execution, but this stage creates no rows automatically and implements no leases.
There is no context-analysis foreign key or combined classifier/context JSON.

The additive `20261028000000_add_moderation_policy_evaluations` migration enforces:

- Nullable priority within 0–100; nonnegative attempt count.
- SUCCEEDED requires risk, priority, an array of signals, and evaluatedAt, with
  no error code. JSON null is not a successful signal list.
- PENDING/FAILED/UNSUPPORTED have no advisory output or evaluatedAt. evaluatedAt
  means successful evaluation time, not last attempt time.
- Error codes are optional uppercase machine codes, 1–64 ASCII characters,
  starting with a letter. A retrying PENDING row may retain its last error code.

SQL checks are not represented by Prisma's datamodel; preserve them in future
migrations. Signal membership/uniqueness and exact supported policy version are
application-contract checks. Historical versions remain representable in storage.
Future services must enforce successful-output immutability and lease fencing;
the database checks alone do not implement a transition state machine.

Generate migration SQL using read-only `prisma migrate diff` between the previous
schema and current schema; apply through the repository's `prisma migrate deploy`
workflow only after review. This stage does not deploy to the development schema.

Checks (from backend):

```powershell
npx.cmd prisma format
npx.cmd prisma validate
npx.cmd prisma generate
npm.cmd test -- --runInBand moderation-policy moderation-analysis
npm.cmd run test:e2e -- --runInBand moderation-policy-schema.e2e-spec.ts moderation-results.e2e-spec.ts
npx.cmd tsc --noEmit
npm.cmd run build
```

The database suites use the existing isolated-case helper: random `case_test_*`
schemas only, with cleanup limited to the generated schema. The helper applies
the real additive policy migration after analysis migrations, so custom SQL
constraints are exercised rather than inferred from Prisma schema generation.
