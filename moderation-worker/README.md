# Stage 2C moderation worker

NestJS owns PostgreSQL and all moderation state. The stateless Python process
reads requests from Kafka, fetches the stored text snapshot through authenticated
HTTP, verifies identity and its SHA-256 hash, runs a deterministic fixture, then
publishes a Stage 2B result. Only NestJS writes the database. No database driver,
raw TCP application protocol, model download, policy action or content deletion
is included. Old generations complete as historical analyses; they do not replace
newer generations or change the case.

```text
Report HTTP -> transaction(case, analysis PENDING, outbox) -> Kafka requests
 -> Python -> authenticated immutable input HTTP -> hash check -> fixture
 -> confirmed Kafka result -> Stage 2B dedupe + conditional terminal DB update
```

## Layout

- `app/main.py`: configuration, composition, signals and exit status.
- `app/config.py`: validated configuration; no import-time environment singleton.
- `app/contracts.py`: strict request/input/result contracts and canonical hashing.
- `app/backend_client.py`: `ModerationInputClient`, pooled bounded HTTP retrieval.
- `app/classifier.py`: replaceable `Classifier` protocol and `FixtureClassifier`.
- `app/processing.py`: identity verification, text projection and result assembly.
- `app/kafka_consumer.py`: polling, assignment cancellation and offset ownership.
- `app/kafka_producer.py`: confirmed result/quarantine delivery.
- `app/errors.py`: bounded failure categories, without private exception text.
- `tests/`: unit/fault tests and shared TypeScript/Python fingerprint vectors.

The incomplete duplicate `src/` package was consolidated into `app/`.
Run `python -m app.main`, not the old `src.worker` entry point.

## Windows PowerShell setup

From the repository root:

```powershell
Set-Location moderation-worker
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
```

Edit your existing `.env` locally; do not overwrite valid secrets. Set the same
random `MODERATION_WORKER_TOKEN` in backend and worker (32?512 printable ASCII
characters, at least 32 random bytes of entropy recommended). Example generation:
`python -c "import secrets; print(secrets.token_urlsafe(32))"`. Never paste the
result into source control or logs. The former placeholder `pastekeyhere` is
intentionally rejected. Existing worker env files also need `BACKEND_BASE_URL`,
`WORKER_ENV=local` and `KAFKA_SECURITY_PROTOCOL=PLAINTEXT` for loopback development.
`REQUEST_TIMEOUT_SECONDS` and `WORKER_MODEL_*` are no longer configuration keys;
use `HTTP_TIMEOUT_SECONDS`; fixture identity is fixed in code.

Backend prerequisites: apply existing Stage 2A/2B migrations to a development
database through your normal workflow, ensure Redis and Kafka are available,
and provision the three topics below. This review does not migrate your configured
database. From `backend/`:

```powershell
node node_modules/prisma/build/index.js generate
npm.cmd run build
npm.cmd run start:dev
```

Backend startup now validates its worker token. Worker dependencies and environment
remain isolated from NestJS. From `moderation-worker/`:

```powershell
.\.venv\Scripts\python.exe -m app.main
```

Stop with Ctrl+C. SIGINT/SIGTERM cancel work and close resources. Windows forced
process termination cannot run Python signal cleanup; Kafka replay still applies.
Use a supervisor with restart backoff (for example 5 seconds rising to 60 seconds).
Authentication failures require operator intervention before restart.

## Environment

| Variable | Default / requirement |
|---|---|
| `WORKER_ENV` | `production`; `local` permits loopback HTTP and plaintext Kafka |
| `BACKEND_BASE_URL` | Required HTTP(S) origin, no path, query or credentials; HTTPS outside local loopback |
| `MODERATION_WORKER_TOKEN` | Required shared secret, hidden in settings representations |
| `KAFKA_BROKERS` | Required comma-separated bootstrap brokers |
| `KAFKA_MODERATION_WORKER_GROUP_ID` | `gachahub-moderation-worker`; same value across replicas |
| `KAFKA_MODERATION_REQUEST_TOPIC` | `gachahub.moderation.requests` |
| `KAFKA_MODERATION_RESULT_TOPIC` | `gachahub.moderation.results` |
| `KAFKA_MODERATION_QUARANTINE_TOPIC` | `gachahub.moderation.requests.quarantine` |
| `HTTP_TIMEOUT_SECONDS` | 10, greater than 0 and at most 30; connect/read/write/pool timeouts and streamed-body deadline |
| `HTTP_ATTEMPTS` | 3, range 1?5 |
| `RETRY_BASE_SECONDS` | 0.5, greater than 0 and at most 5 |
| `DELIVERY_TIMEOUT_SECONDS` | 15, range 1?60; no acknowledgment by deadline is failure |
| `KAFKA_SECURITY_PROTOCOL` | `SSL`; `PLAINTEXT`, `SSL`, `SASL_PLAINTEXT`, `SASL_SSL`; production requires TLS |
| `KAFKA_SASL_MECHANISM` | `SCRAM-SHA-512`; also `SCRAM-SHA-256`, `PLAIN` |
| `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD` | Both required for SASL |
| `KAFKA_SSL_CA_LOCATION` | Optional private CA bundle; certificate verification remains enabled |
| `KAFKA_SSL_CERTIFICATE_LOCATION`, `KAFKA_SSL_KEY_LOCATION`, `KAFKA_SSL_KEY_PASSWORD` | Optional mTLS certificate, key and key password |

The backend still has its existing fixed request/result topic names; changing
worker topics alone does not redirect NestJS. The live test overrides backend
constants only inside its isolated test process. Backend Kafka clients currently
have no SASL/TLS environment wiring: secure broker integration across those
clients is a confirmed deployment follow-up, not verified by local plaintext tests.

## Internal HTTP and integrity

`GET /internal/moderation/analyses/:analysisJobId/input` bypasses the Better Auth
session requirement through `AllowAnonymous`, then always requires the dedicated
`ModerationServiceAuthGuard`. It compares fixed-length SHA-256 token digests using
constant-time comparison. Missing/bad tokens return 401; invalid IDs 400; unknown
jobs 404; unsupported/corrupt stored data 500. The controller is excluded from
Swagger, but exclusion is not an access control. Module middleware sets `no-store`
and `no-cache` on successful and failed responses.

The response selects only analysis identity, target identity and the stored input;
it never loads live content, reporter identities, complaint details, emails, media
or parent context. POST has `{type,title,content}`, COMMENT `{type,content}`.
The API and worker reject unsupported schema/profile, extra fields, invalid text,
more than 300 title or 20,000 content Unicode code points and responses over 256 KiB.
Requests/results are bounded to 32 KiB. A full truncated prefix may end in whitespace:
Stage 2A trims before truncating; readers must not trim it again.

Fingerprint protocol is unchanged: SHA-256 of UTF-8 compact JSON with fixed key
order `inputSchemaVersion,input`, then POST `type,title,content` or COMMENT
`type,content`, no trailing newline. Python matches JSON.stringify escaping and
ECMAScript trim semantics for source test vectors; stored content is hashed
verbatim, never re-normalized before hashing. Both API and worker recompute hashes.
The worker compares every request identity field, including target ID/type, schema
version and profile, before classifying. The shared vectors cover Vietnamese/NFC,
emoji, null/empty title, empty content, controls, quotes, backslash, Unicode
separators, ECMAScript whitespace and truncation at a space.

## Delivery, cancellation and recovery

Each instance handles one record at a time and pauses all assigned partitions.
HTTP/classification runs in one background thread while the consumer keeps polling
for group callbacks. On revoke/loss it cancels the job; the assignment epoch is
checked during publishing and before synchronous per-record commits. New work does
not overlap unfinished work. Scale using multiple replicas and enough partitions.

The producer uses `acks=all` and idempotence. Only a successful delivery callback
allows a commit; queue-full errors, callback failures and timeouts stop the worker
with the original request uncommitted. A flush return value is never treated as
proof of delivery; see the [official Confluent delivery API](https://docs.confluent.io/platform/current/clients/confluent-kafka-python/html/index.html). No later record can commit past an earlier failed job. A crash
between acknowledgment and commit can publish duplicates. UUIDv5 result identity
is stable for a job/hash/profile; completion timestamps can differ on replay.
Stage 2B's ProcessedEvent, identity checks and PENDING-to-terminal guard remain the
authority. This is at-least-once processing, not end-to-end exactly once.

| Failure | Action |
|---|---|
| HTTP timeout/transport error, 429, 5xx | Up to configured attempts; exponential backoff `min(10, base*2^attempt) * uniform(0.5,1.5)`; then quarantine |
| HTTP 401/403 | Stop, alert `service_authentication_failed`, leave offset uncommitted |
| HTTP 404/410 | Quarantine `INPUT_NOT_FOUND`; investigate analysis deletion/retention |
| Other non-200, redirect, encoded response | Quarantine with fixed reason |
| Invalid request/input, unsupported schema/profile, identity/hash mismatch | Quarantine and structured alert |
| Classifier exception or invalid output | Valid FAILED result with `CLASSIFIER_ERROR`; Stage 2B accepts bounded uppercase codes, not an enum |
| Result or quarantine delivery failure; offset commit failure | Stop without advancing to another request; supervisor/operator recovery |
| Shutdown/rebalance | Cancel/discard in-flight outcome, leave request for replay |
| Backend result consumer offline | Kafka retains result until consumer returns, within retention |

Logs contain timestamp, severity, fixed event names and partition/offset, never content, tokens, raw
Kafka records, parser details or HTTP exception strings. Monitor process exits,
quarantine records, request/result group lag and aged PENDING analyses. No alerting
service or external notifications are installed by this stage. Quarantine and
fatal events are emitted at ERROR severity for monitoring integration.

## Quarantine topic and operator procedure

Provision `gachahub.moderation.requests.quarantine` before starting workers. Disable
automatic topic creation at the broker and use ACLs; producers cannot be relied on
to enforce topic administration. For local Docker, run this command for each of the
request, result and quarantine topic names (partition count must match your plan):

```powershell
docker exec gachahub-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic gachahub.moderation.requests.quarantine --partitions 3 --replication-factor 1 --config retention.ms=604800000
```

Use replication/minimum ISR appropriate to production, and bounded broker message
sizes. Suggested retention: requests/results 14 days, quarantine 7 days; confirm
against content/incident retention policy before rollout. Local replication 1 is
not fault tolerance. Do not shorten existing topic retention without review.

Quarantine envelope v1 is metadata only:

```json
{"type":"moderation.request.quarantined","version":1,"eventId":"UUIDv5",
 "source":{"topic":"source-topic","partition":0,"offset":42},
 "requestSha256":"64 lowercase hex characters","reason":"INPUT_INTEGRITY"}
```

Allowed emitted reasons are `REQUEST_CONTRACT`, `UNSUPPORTED_INPUT`,
`INPUT_IDENTITY`, `INPUT_INTEGRITY`, `INPUT_NOT_FOUND`, `INPUT_ENCODING`,
`INPUT_TOO_LARGE`, `INPUT_CONTRACT`, `HTTP_PERMANENT`, `HTTP_RETRIES_EXHAUSTED`.
No original payload, record headers, target identity or exception text is copied.
Only confirmed quarantine delivery permits committing the source record. Quarantine
records do not mark an analysis terminal: affected analyses intentionally remain
PENDING until investigated or replayed.

Alert on every record. Restrict read access to operators; workers may write this
topic but cannot read it. Source coordinates permit retrieval while requests are
retained. Investigate the fixed reason, repair configuration/data at the backend,
and retrieve/re-publish the original valid request from the retained source topic
or durable outbox using its original identity. For an invalid record, reconstruct
only from the authoritative stored analysis; never blindly replay malformed JSON.
Group-offset reset is an alternative with all workers stopped, but it replays later
records too. Never edit immutable snapshots to force hash agreement. Record incident
resolution before quarantine/source retention expires. Automated replay, retention
cleanup and pending-job reconciliation are deferred.

## Security boundaries

Restrict `/internal/moderation/*` to the worker network using private ingress,
firewall/network policy or a service mesh. Route exclusion and the token are not
network isolation. Terminate HTTPS on trusted ingress (or use an equivalent encrypted
service network); this worker intentionally requires an HTTPS URL outside loopback.
Do not forward bearer headers or private response bodies into access logs. Disable
caching, including ingress overrides. Restrict worker egress to backend HTTPS,
Kafka and required DNS; it needs no PostgreSQL, storage or internet model access.
Use a non-admin runtime identity and secret/certificate mounts with read-only
permissions. Kafka ACLs: read requests + own group; write results/quarantine;
NestJS writes requests and reads results. Backend Kafka TLS/SASL wiring and actual
network/ACL/retention policy require deployment work before nonlocal use.

For secret rotation, stop/pause workers, update both secret stores, restart backend
(validation/guard captures the token at startup), restart workers, then revoke the
old secret. The short coordinated pause avoids a dual-token framework. An accidental
mismatch stops consumption without committing and can be corrected safely.

## Verification

Unit and native HTTP checks:

```powershell
# moderation-worker/
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m pip check
# backend/
npm.cmd test -- --runInBand moderation-analysis reports.repository.spec.ts kafka-background-start.spec.ts kafka-lifecycle.spec.ts
npm.cmd run build
node test/moderation-input-http.cjs
```

The native HTTP runner uses the real installed global Better Auth guard and real
Nest HTTP/module wiring with fixture repository/session lookup, without Kafka.
It does not authenticate a real Better Auth user session.

Live integration is opt-in, requires running local Kafka, worker `.venv`, and an
explicit **disposable local PostgreSQL** URL. It never falls back to your normal
DATABASE_URL. Start a disposable PostgreSQL instance through your approved local
workflow; example test-only credentials and port below are not deployment secrets:

```powershell
# backend/
$env:RUN_MODERATION_WORKER_LIVE='1'
$env:MODERATION_TEST_DATABASE_URL='postgresql://postgres:stage2c-local-fixture@127.0.0.1:15432/stage2c_test'
$env:DATABASE_URL=$env:MODERATION_TEST_DATABASE_URL
node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand moderation-worker-live.e2e-spec.ts moderation-results.e2e-spec.ts
Remove-Item Env:RUN_MODERATION_WORKER_LIVE
Remove-Item Env:MODERATION_TEST_DATABASE_URL
Remove-Item Env:DATABASE_URL
```

The harness creates randomized schemas, three randomized short-retention Kafka
topics, unique groups and real Python subprocesses. It submits a real report HTTP
request using a fixture user session; real account/visibility checks, reporting
transaction, outbox dispatcher, internal auth/input API, Kafka and Stage 2B persistence
run normally. It tests post edits after capture, invalid token, an unreachable result
producer, transient backend 503, injected failure after real acknowledgment before
commit, restart, duplicates, two worker instances/rebalance, old results after a
new generation, result-consumer stop/restart with retained Kafka results, and actual
quarantine publication. Only the user-session source
and explicit fault hooks are fixtures. No real login, deployed service restart,
broker restart or production TLS/ACL path is claimed. Cleanup terminates child
processes, deletes only test topics, removes inactive test groups where possible,
and drops the generated schema. A group still active after forced termination
expires by broker group retention.

## Limitations and Stage 2E

The fixture reacts only to `fixture-toxic` / `fixture-violence`, has no ML accuracy
claim, and is not a production policy classifier. Stage 2E should implement the
same `Classifier.classify(text) -> ClassifierOutput` boundary with bounded runtime
and model lifecycle management. Introduce a new immutable classifier profile and
supported profile routing when changing preprocessing/model semantics; do not
repoint `moderation-text-v1`. Cancellation is cooperative around inference: the
current fixture is short-lived; future noninterruptible inference needs a bounded
execution/cancellation strategy before rollout. No Torch/Transformers/models were
installed here. No policy automation, automatic removal, analysis lease, automated
quarantine replay or reconciliation service is implemented.
