# Stage 2A: text analysis requests

`ReportsRepository.create` owns the transaction and case lock. The scheduler
copies text from the already captured Report evidence, reuses an existing
`(caseId, snapshotHash, classifierProfile)` job, or inserts a job and publishes
`moderation.analysis.requested` through `EventPublisherPort` in that transaction.
Generation is the indexed maximum for that case plus one, allocated under its
lock; `(caseId, generation)` is also unique. Unique conflicts roll back and use
the repository's existing fresh-transaction retry. No broker work occurs here.

Input schema 1 contains exactly `{type:"POST",title:string|null,content:string}`
or `{type:"COMMENT",content:string}`. Normalize strings to Unicode NFC, replace
CRLF and CR with LF, trim edges, and retain at most 300 title / 20,000 content
Unicode code points. Interior whitespace remains significant. Bounds define
the analyzed prefix: suffix-only changes outside the bounds intentionally dedupe.
Empty titles become null. Empty text remains representable; there is no inference
or content decision at this stage. Media and complaint fields are excluded.

Fingerprint protocol: SHA-256 over UTF-8 compact JSON (no trailing newline),
with fixed property order `{inputSchemaVersion:1,input:...}`; POST order is
`type,title,content`, COMMENT order is `type,content`. Store as `sha256:<hex>`.
The exact stored input is the fingerprinted input. Future cross-language readers
must follow this ordering and JSON escaping rather than hashing arbitrary JSON.

`moderation-text-v1` is a centralized identity for a future immutable classifier
and preprocessing bundle, not a configured model. Never repoint it to different
models; introduce a new profile. There is no manual reanalysis path yet.

The existing event envelope has version 1, aggregateId = caseId, and payload:
`analysisJobId,caseId,targetType,targetId,generation,snapshotHash,inputSchemaVersion,classifierProfile`.
The existing producer routes it to `gachahub.moderation.requests`, keyed by caseId.
Text and reporter information stay out of Kafka.

Stage 2A creates analysis status `PENDING`. OutboxEvent owns publication state; a
published job remains PENDING until a result is received (Stage 2B below). Source Report
deletion sets its reference to null and preserves the copied input. Case deletion
cascades analysis deletion because the case owns its lifecycle. A new case gets
its own job, even for an identical fingerprint. Reverting content within the same
case reuses the earlier job without a new generation/event.

Kafka producer and notification startup use the same background retry helper.
HTTP startup does not await broker connections. The dispatcher leaves rows
unclaimed while the producer's initial connection is unavailable; normal existing
publication retries apply after connection. Shutdown cancels scheduled retries.
Notification event processing and transactional deduplication are unchanged.

Deferred: worker/API, leases, risk/policy, content revisions, media,
automated actions, and retention automation. Review text retention and chosen
prefix limits before production rollout. No cleanup job is introduced here.

## Stage 2B: historical analysis results

`ModerationResultsModule` consumes `gachahub.moderation.results` with the existing
background startup/shutdown helper. `KAFKA_MODERATION_RESULTS_GROUP_ID` defaults
to `gachahub-moderation-results`. No worker or inference service is included.

The version 1 `moderation.result` envelope requires a UUID eventId and
aggregateId equal to payload.caseId. The strict contract rejects unknown keys at
every object level and messages over 32 KiB. Identity includes analysisJobId,
caseId, positive PostgreSQL integer generation, sha256 snapshotHash and bounded
classifierProfile. SUCCEEDED requires bounded model name/revision and 1–32
case-insensitively unique labels with finite scores in [0,1]. FAILED requires a
bounded uppercase machine errorCode. PARTIAL and free-form error details are
unsupported. Both statuses require completedAt; the envelope requires occurredAt.
Identity/model strings reject NUL and unpaired Unicode surrogates so PostgreSQL
text/JSONB encoding errors cannot turn malformed input into endless retries.

One transaction claims ProcessedEvent with consumer `moderation-results`, loads
the job, verifies immutable identity, locks the case, then updates the job only
WHERE status=PENDING. Unknown jobs and identity mismatches commit only the claim.
Case locking uses parameterized SQL, consistent with report creation; no shared
case-lock helper exists. The initial job read is not a row lock: mutation lock
ordering remains case then analysis. Terminal data cannot be overwritten by a
different eventId. A database failure rolls back claim and result and escapes to
Kafka for retry through a fixed error message (KafkaJS logs thrown errors, and
Prisma errors may contain query arguments). Malformed input is logged with a fixed message and skipped
before opening a transaction; raw payloads and parser errors are never logged.

Stored result contains acceptedEventId, completedAt and either normalized output
or errorCode. Closed cases and earlier generations retain historical results.
No case fields, audit/action records, content, reports, risk or policy are changed.

Run focused tests from backend (DATABASE_URL and KAFKA_BROKERS come from .env):

```powershell
npm.cmd test -- --runInBand moderation-analysis reports.repository.spec.ts kafka-background-start.spec.ts kafka-lifecycle.spec.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand moderation-results.e2e-spec.ts report-creation.e2e-spec.ts moderation-results-kafka.e2e-spec.ts
```

PostgreSQL tests create/drop only randomized isolated schemas and apply the real
additive result migration. Kafka tests publish bounded synthetic fixtures to the
real results topic using a temporary consumer group, which is removed afterward.
The results topic is retained. No shared database reset or deployed fake service
is needed.
