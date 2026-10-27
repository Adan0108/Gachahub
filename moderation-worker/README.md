# Stage 2C / 2E moderation worker

NestJS owns PostgreSQL and all moderation state. The stateless Python process
reads requests from Kafka, fetches the stored text snapshot through authenticated
HTTP, verifies identity and its SHA-256 hash, runs the selected local classifier, then
publishes a Stage 2B result. Only NestJS writes the database. No database driver,
raw TCP application protocol, policy action or content deletion is included.
Stage 2E can download a pinned Hugging Face model to the normal local cache.
Old generations complete as historical analyses; they do not replace
newer generations or change the case.

```text
Report HTTP -> transaction(case, analysis PENDING, outbox) -> Kafka requests
 -> Python -> authenticated immutable input HTTP -> hash check -> classifier
 -> confirmed Kafka result -> Stage 2B dedupe + conditional terminal DB update
```

## Layout

- `app/main.py`: configuration, composition, signals and exit status.
- `app/core/config.py`: validated configuration; no import-time environment singleton.
- `app/contracts/moderation.py`: strict request/input/result contracts and canonical hashing.
- `app/infrastructure/http/backend_client.py`: `ModerationInputClient`, pooled bounded HTTP retrieval.
- `app/classifiers/base.py`: `Classifier` protocol and factory.
- `app/classifiers/fixture.py`: deterministic `FixtureClassifier`.
- `app/classifiers/huggingface.py`: pinned local CPU inference behind that protocol.
- `app/classifiers/model_profile.py`: immutable model identity, profile and token limit.
- `app/evaluation/evaluate_classifier.py`: standalone English/Vietnamese observations.
- `app/processing/job_processor.py`: identity verification, text projection and result assembly.
- `app/infrastructure/kafka/consumer.py`: polling, assignment cancellation and offset ownership.
- `app/infrastructure/kafka/producer.py`: confirmed result/quarantine delivery.
- `app/core/errors.py`: bounded failure categories, without private exception text.
- `tests/`: unit/fault tests and shared TypeScript/Python fingerprint vectors.

Runtime modules are grouped into core, contracts, processing, infrastructure,
classifiers, and evaluation packages. Unit tests live under `tests/unit/`;
real-model/fault harnesses live under `tests/integration/`.
`tests/live_fault_worker.py` preserves the external live-harness entry point.
The `app.contracts` and `app.processing` packages retain their public imports for
external harnesses; implementations live in their named submodules.
Run `python -m app.main`, not the old `src.worker` entry point.

## Windows PowerShell setup

For the independently containerized worker, see [Separate worker Compose](#separate-worker-compose).
The setup below remains available for running Python directly on the host.

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
| `WORKER_ENV` | `production`; `local` permits loopback / exact `host.docker.internal` HTTP and plaintext Kafka |
| `BACKEND_BASE_URL` | Required HTTP(S) origin, no path, query or credentials; production always requires HTTPS |
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
service network); outside local mode this worker always requires an HTTPS URL.
Do not forward bearer headers or private response bodies into access logs. Disable
caching, including ingress overrides. Restrict worker egress to backend HTTPS,
Kafka and required DNS. The Hugging Face backend additionally needs Hub/download
access to populate its local cache on first startup; a prewarmed cache permits
`HF_HUB_OFFLINE=1`. It needs no PostgreSQL access.
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
.\.venv\Scripts\python.exe -m unittest tests.unit.test_config tests.unit.test_classifier -v
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

## Separate worker Compose

`backend/docker-compose.yml` continues to own Kafka and Redis. This directory's
`docker-compose.yml` owns only the worker, on its own default Compose network;
it does not join the backend network. Backend npm scripts are unchanged.

One-time setup: copy `.env.example` to `.env` if absent, and set
`MODERATION_WORKER_TOKEN` to the same secret as `backend/.env`. Set the backend's
`MODERATION_CLASSIFIER_PROFILE=toxicity-mmbert-small-v1` before starting NestJS.
Finish any pending fixture-profile requests before switching (see Stage 2E below).
Neither Compose file embeds a real token; worker Compose reads its local `.env`
for interpolation and passes only the listed environment variables to the container.

Terminal 1:

```powershell
cd backend
npm run docker:up
npm run start:dev
```

Terminal 2:

```powershell
cd moderation-worker
docker compose up -d
docker compose logs -f moderation-worker
```

The first worker `up` builds the missing image automatically. No manual `docker
build` or `docker run` is needed. After editing image inputs, use
`docker compose up -d --build`; restart with `docker compose restart`, and stop
the worker independently with `docker compose down`. Start the backend broker
before the worker. Existing topic provisioning requirements still apply.

Host NestJS retains `KAFKA_BROKERS=localhost:9092`. The worker uses
`host.docker.internal:29092`, the second PLAINTEXT listener on the same Kafka
broker. Kafka advertises that hostname on this listener so metadata remains
reachable from the worker's independent network. Backend HTTP is
`http://host.docker.internal:3000`. `extra_hosts: host.docker.internal:host-gateway`
provides the host gateway mapping on Linux as well as Docker Desktop setups.
The host backend must listen on a container-reachable interface (the existing
Nest `app.listen(port)` does so); host firewall rules must permit the connection.
Port 3000 is the current Compose dev contract. Direct host-run Python settings
in `.env.example` remain loopback defaults; Compose overrides the two addresses.

The Python 3.13 slim image installs the existing requirements with CPU-only Torch
from the PyTorch CPU wheel index. It copies only application/download-script
sources. `.env`, `.venv`, tests, host caches and model weights are excluded from
the build context. `python -m scripts.download_model` imports the immutable model
identity from `app.classifiers.model_profile` and downloads only Transformers inference files
from `Horizon-Labs/multilingual-toxicity-small` at
`01adcc628a33848569816d4851a38544c321b92c` during the build.

Actual weights/tokenizer files live in the image under
`/opt/huggingface/hub/models--Horizon-Labs--multilingual-toxicity-small/`, with the
pinned SHA under `snapshots/` and bytes under `blobs/`. There is no host-cache bind
mount or cache volume. Both Dockerfile and Compose set `HF_HUB_OFFLINE=1` for
runtime. Normal restart loads the baked files and does not contact Hugging Face.
Runtime still needs Kafka and backend connectivity. Model name/revision/length
are fixed to the existing immutable bundle, not taken from mutable branch names.
`MODERATION_CLASSIFIER_PROFILE` belongs to backend scheduling; the Python worker
derives its matching profile from `CLASSIFIER_BACKEND=huggingface`.

An already-built image remains usable without the upstream repository. Preserve
that image for long-term availability: keep the local image, optionally export
with `docker save -o worker-image.tar gachahub-moderation-worker:dev`, or arrange
a private registry copy later. Rebuilding still needs the upstream dependencies
and model. No image export or registry publication is performed by this setup.

## Stage 2E local text model

The default remains `CLASSIFIER_BACKEND=fixture` (`moderation-text-v1`). The fixture
still reacts only to `fixture-toxic` / `fixture-violence`; it has no ML accuracy claim.
For real inference select `CLASSIFIER_BACKEND=huggingface` and set the backend's
`MODERATION_CLASSIFIER_PROFILE=toxicity-mmbert-small-v1`, then restart both processes
before creating a new report. Existing `.env` files and secrets are not edited by
this change. The backend input API supports both historical profiles, while a worker
accepts only its selected profile. Finish pending fixture jobs before switching;
mixed profile routing is outside this step. A mismatched request follows the existing
`UNSUPPORTED_INPUT` quarantine behavior. Existing completed analyses remain immutable;
there is no manual reanalysis or migration.

| Worker setting | Default / immutable value |
|---|---|
| `CLASSIFIER_BACKEND` | `fixture`; choose `huggingface` for Stage 2E |
| `CLASSIFIER_MODEL_NAME` | `Horizon-Labs/multilingual-toxicity-small` |
| `CLASSIFIER_MODEL_REVISION` | `01adcc628a33848569816d4851a38544c321b92c` |
| `CLASSIFIER_MAX_LENGTH` | `256` tokens including special tokens |

Model name, revision and length are validated against the immutable bundle, rather
than permitting a mutable branch such as `main` or silently changing preprocessing.
Changing these semantics requires a new profile. This preserves the original
repository contract: `moderation-text-v1` must never be repointed to another model.
No schema migration or event/result contract change is needed. Stored results already
retain `output.model.name`, `output.model.revision` and all `output.labels` scores.

The [pinned model card](https://huggingface.co/Horizon-Labs/multilingual-toxicity-small/blob/01adcc628a33848569816d4851a38544c321b92c/README.md)
declares Apache-2.0 and 256-token toxicity training. Its config/tokenizer capacity
is 8192; the classifier deliberately uses the trained 256-token right prefix.
Labels are read in index order from `config.id2label`: `toxicity`, `severe_toxicity`,
`obscene`, `threat`, `insult`, `identity_attack`, `sexual_explicit`. Each receives an
independent sigmoid probability. There are no thresholds or decisions. Empty and
whitespace strings are tokenized normally, matching the representable-empty contract.
For posts, the existing title + two newlines + content projection precedes tokenization.
The immutable hash covers the full canonical snapshot, even when inference truncates it.

The model loads once before Kafka clients are created, using AutoTokenizer and
AutoModelForSequenceClassification, safetensors, CPU eager attention, `eval()` and
`torch.inference_mode()`. Remote repository code is disabled. Loading failure stops
startup; there is no fallback. Runtime inference failures keep the existing
`CLASSIFIER_ERROR` result path. Fixture imports do not import Torch/Transformers.

First real startup downloads approximately 563 MB of weights plus a 34 MB tokenizer
to the normal Hugging Face cache (`~/.cache/huggingface/hub`, or the existing `HF_HOME`
configuration). Later runs reuse it. No model files belong in this repository.
Windows without symlink support still caches files, potentially using more disk.

Run standalone evaluation **before** enabling the real worker (no HTTP/Kafka/DB):

```powershell
# moderation-worker/
.\.venv\Scripts\python.exe -m app.evaluation.evaluate_classifier
# Prints every label for four English and five Vietnamese synthetic examples.
# Optional: after the first successful download, use cached files only.
$env:HF_HUB_OFFLINE='1'
$env:RUN_REAL_MODEL_TESTS='1'
.\.venv\Scripts\python.exe -m unittest tests.integration.test_real_classifier.RealModelTests -v
Remove-Item Env:RUN_REAL_MODEL_TESTS
Remove-Item Env:HF_HUB_OFFLINE
```

Ordinary `unittest discover` tests stub inference libraries and never download
weights. The opt-in test loads one model and checks actual labels, finite bounded
scores, repeated inference tolerance, 256-token truncation and empty/whitespace input.
No model quality thresholds are asserted.

The existing live harness also has a scoped real-model mode. After standalone
evaluation has populated the cache, provide running local Kafka and an explicitly
disposable loopback PostgreSQL URL, then run from `backend/`:

```powershell
$env:RUN_MODERATION_REAL_MODEL_LIVE='1'
# Set MODERATION_TEST_DATABASE_URL to your disposable local database; never use a shared DB.
$env:DATABASE_URL=$env:MODERATION_TEST_DATABASE_URL
node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand moderation-worker-live.e2e-spec.ts
Remove-Item Env:RUN_MODERATION_REAL_MODEL_LIVE
Remove-Item Env:DATABASE_URL
```

This selects one real-model test instead of the fixture fault scenario. It reuses
the real report/outbox/Kafka/authenticated HTTP/Stage 2B harness, requires SUCCEEDED
and a committed offset, asserts the stored model/revision and seven bounded scores,
and compares the entire case and post before/after. Its random schema/topics/groups
are cleaned by the existing harness. See [Stage 2E review evidence](STAGE2E.md) for
measured outputs and checks, including whether the live test ran.

Cancellation remains cooperative around noninterruptible inference; the 256-token
bound limits input size but is not a wall-clock deadline. Process isolation/hard
inference deadlines are deferred before production rollout. No policy automation,
automatic removal, analysis lease, automated quarantine replay or reconciliation
service is implemented.
