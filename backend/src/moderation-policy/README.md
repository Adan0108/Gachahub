# Stage 2D.1: policy foundation

This package defines advisory contracts and production classifier compatibility
only. The empty module is not wired into ingestion. There are no policy rules,
thresholds, evaluations, runners, actions, or context-model implementations.

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
