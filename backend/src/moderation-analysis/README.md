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

Only analysis status `PENDING` exists. OutboxEvent owns publication state; a
published job remains PENDING until future processing stages exist. Source Report
deletion sets its reference to null and preserves the copied input. Case deletion
cascades analysis deletion because the case owns its lifecycle. A new case gets
its own job, even for an identical fingerprint. Reverting content within the same
case reuses the earlier job without a new generation/event.

Kafka producer and notification startup use the same background retry helper.
HTTP startup does not await broker connections. The dispatcher leaves rows
unclaimed while the producer's initial connection is unavailable; normal existing
publication retries apply after connection. Shutdown cancels scheduled retries.
Notification event processing and transactional deduplication are unchanged.

Deferred: worker/API, leases, results, risk/policy, content revisions, media,
automated actions, and retention automation. Review text retention and chosen
prefix limits before production rollout. No cleanup job is introduced here.
