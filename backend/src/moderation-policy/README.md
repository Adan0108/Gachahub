# Moderation policy: foundation, pure rules and durable execution

For an end-to-end introduction and runtime file map, see the
[moderation pipeline walkthrough](../../docs/moderation-pipeline.md).

Stage 2D.1 defines schema/contracts and the production classifier registry.
Stage 2D.2 adds pure classifier-score to advisory mapping through
`ModerationPolicyService.evaluate(input)`. Pure evaluation has no injected infrastructure,
database writes, network calls, clock, randomness, or environment lookup.

Stage 2D.3 adds durable backend execution below. Stage 2D.4 projects freshness
on existing moderator case reads. Queue sorting, context/NLI models and enforcement
remain out of scope. Persisted evaluations remain historical records.

## Stage 2D.4 freshness-aware case reads

The platform and game case list/detail routes share the `AiAdvisory` union in
`reports/domain/ai-advisory.ts`. `CURRENT` contains `analysisGeneration`,
`policyVersion`, `riskLevel`, `priorityScore`, `signals` and ISO `evaluatedAt`.
Every other state contains only `state` and an optional `analysisGeneration`;
historical risk/priority/signals are never a fallback. Legacy case risk fields,
queue ordering and filters are unchanged.

After existing authorization, each response reads all contributors in one scoped
PostgreSQL `REPEATABLE READ`, `READ ONLY` transaction. Game ownership is checked
inside that snapshot. No transaction spans external network work. Database errors
fail the request normally; GETs never schedule, repair or evaluate work.

The pure projection checks, in order:

1. RESOLVED/DISMISSED case: `CASE_CLOSED`.
2. Missing/deleted target or unavailable comment parent: `TARGET_UNAVAILABLE`.
3. No analysis: `NO_ANALYSIS`.
4. Unverifiable canonical/input metadata: `FRESHNESS_UNVERIFIED`.
5. Current canonical hash differs: `CONTENT_CHANGED`.
6. Analysis PENDING/FAILED: `ANALYSIS_PENDING`/`ANALYSIS_FAILED`.
7. Successful evidence unsupported by the production parser/registry:
   `UNSUPPORTED_EVIDENCE`.
8. Active `moderation-policy-v1` absent/PENDING: `POLICY_PENDING`; FAILED:
   `POLICY_FAILED`; UNSUPPORTED: `UNSUPPORTED_EVIDENCE`.
9. Successful policy output/date invalid: `FRESHNESS_UNVERIFIED`; otherwise
   `CURRENT`.

The candidate is always the highest allocated generation across all statuses and
profiles, selected with a parameterized lateral `ORDER BY generation DESC LIMIT 1`.
Only its active-version policy row is joined. Completion time and older successful
rows cannot override it. With scheduler reuse for A -> B -> A, generation B remains
the candidate and the result is `CONTENT_CHANGED`; scheduling semantics are unchanged.

Canonical hashing reuses `canonical-text-input.ts`, including its existing NFC,
newline normalization, trim, code-point bounds and versioned SHA-256 format.
Freshness describes that bounded analyzed prefix, not text beyond its bounds.
List preview SQL privately loads current text for hashing, then explicitly returns
the existing preview allowlist. Raw text, classifier results and lease/retry fields
are not added to the response. Detail reuses its existing target read.

A nonempty list uses four bounded data operations: case page, target previews,
reason aggregation and one advisory query. Prisma relation/auth/transaction SQL
adds constant overhead. Existing case/generation and analysis/policy-version unique
indexes serve the joins; no migration is added. The PostgreSQL/HTTP regression suite
checks query counts and actual advisory query plans at page sizes 20, 50 and 100,
all five generation/content races, snapshot consistency, authorization and read-only
behavior. No frontend advisory UI is introduced in this stage.

## Stage 2D.3 durable execution

`ModerationResultsModule` imports `ModerationPolicyModule`. In the existing
result-ingestion transaction, only a winning PENDING -> SUCCEEDED update enqueues
`(analysisId, moderation-policy-v1)` with create-or-ignore semantics. The event
claim, accepted classifier result and policy work commit together. An enqueue
failure rolls all three back for Kafka replay. FAILED classifier results enqueue
nothing. Identity/hash checks, case locking and the terminal result guard remain
unchanged. Policy evaluation never runs in that transaction.

The backend runner loads the persisted `result.output.model` and
`result.output.labels` array, validates the wrapper/unique labels, constructs
classifier evidence, evaluates the pure policy, validates output, then writes
the advisory in a separate database statement. It never evaluates a raw Kafka
payload. Source analyses and case/content state are never changed by the runner.

Claims use a single PostgreSQL CTE with FOR UPDATE SKIP LOCKED followed by UPDATE
RETURNING. Only v1 PENDING work with a due retry and absent/expired lease is
eligible. Each claim increments attemptCount and installs a random UUID token.
Finalization and retry require PENDING, that exact token and an unexpired lease,
using database time. A reclaimed row has a different token; stale writes update
zero rows. Successful terminal output cannot be overwritten. Database failures
leave the lease recoverable rather than being mislabeled as unsupported evidence.

Execution constants are centralized:

- Maximum attempts: 5 (including attempts abandoned by crashes).
- Lease: 30 seconds; no heartbeat is needed for the bounded synchronous v1 rules.
- Retry: 2 seconds \* 2^(attempt-1), capped at 60 seconds.
- Poll: 2 seconds after the previous cycle completes; at most 10 items per cycle.
- Reconciliation: one page of at most 100 analyses every 60 seconds.

Internal failures remain PENDING with nextAttemptAt until attempt 5 becomes FAILED
with POLICY_EVALUATION_ERROR. Unsupported evidence becomes UNSUPPORTED immediately
with UNSUPPORTED_CLASSIFIER_EVIDENCE. A fifth attempt abandoned by a crashed runner
becomes FAILED/POLICY_ATTEMPTS_EXHAUSTED when its expired lease is next examined.
No raw input, exception messages or stacks are persisted/logged. Successful
evaluation uses database time for evaluatedAt and clears all retry/lease errors.

Reconciliation walks ALL analyses in primary-key order, inspecting no more than
100 per page even when successes are sparse. It inserts missing v1 work for
SUCCEEDED analyses only; the unique key makes competing reconciliation/ingestion
safe. A process-local cursor advances only after commit, wraps at the end, and
restarts after process restart. New lower IDs or concurrent successes are picked
up on a later sweep. Existing status/retry, lease, PK and analysis/version indexes
are used; no schema/migration change is needed. Backfill does not replay Kafka.

Lifecycle polling is nonoverlapping. Shutdown cancels the next timer, stops
claiming additional work and awaits the in-flight cycle before returning.
This depends on deploying the existing Stage 2D.1 migration before enabling the
updated application; this stage does not apply development migrations.

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
execution. Stage 2D.3 implements creation, claims, retries and fenced completion.
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
The execution repository enforces terminal-output immutability and lease fencing;
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
npm.cmd run test:e2e -- --runInBand moderation-policy-execution.e2e-spec.ts
npx.cmd tsc --noEmit
npm.cmd run build
```

The database suites use the existing isolated-case helper: random `case_test_*`
schemas only, with cleanup limited to the generated schema. The helper applies
the real additive policy migration after analysis migrations, so custom SQL
constraints are exercised rather than inferred from Prisma schema generation.
