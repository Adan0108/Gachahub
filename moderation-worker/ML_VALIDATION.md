# Production toxicity regression validation

Model: `Horizon-Labs/multilingual-toxicity-small`, immutable revision `01adcc628a33848569816d4851a38544c321b92c`, profile `toxicity-mmbert-small-v1`. Scores remain advisory and are not calibrated violation probabilities.

## Inference invariants

- POST input is canonical title + two newlines + content; COMMENT input is content alone. The title participates once in the ordered token stream, rather than consuming space in every window.
- Each window has 256 model tokens, including the pinned tokenizer's two special tokens: 254 payload tokens, 64-token overlap, 190-token advance. Window reconstruction must exactly match the complete token stream.
- Long inputs use batches of four and **per-label MAX**. MEAN can dilute a localized harmful segment and is evaluated only as a comparison. Short inputs retain the former tokenizer/model path.
- Input schema 1 limits are 300 title and 30,000 content codepoints. The verified tokenizer expansion bound gives at most 638 POST windows / 160 forwards and 632 COMMENT windows / 158 forwards. The shared COMMENT work ceiling is conservative; product comments still allow only 2,000 characters. Invalid bounds, coverage or batch output fail the analysis; no tail is silently dropped.
- The seven labels, model/profile identity, JSON serialization, result identity, Kafka contracts and policy thresholds are unchanged. Canonical hashes use only inputSchemaVersion=1 and the 30,000-content bound. Development processing state must be reset and inference rerun before reuse; no old-result hash rewrite or schema compatibility path is supported.

## Reusable checks

`tests/fixtures/toxicity-reference-v1.json` contains synthetic bilingual examples and deterministic long-text recipes, not expected score dumps. The evaluation helpers add beginning/middle/end contrasts for five harmful signals in English, Vietnamese and mixed language, plus benign long gaming controls: 123 cases total.

Tests cover exact model identity and labels, finite bounded scores, short-input equality against Transformers, full-token coverage, overlapping boundaries, Unicode expansion/work limits, atomic batch failures, title/tail coverage, canonical equivalents, and processor/result serialization. Shared TypeScript/Python golden vectors verify NFC/NFD, newline normalization, trimming, emoji and fixed-order SHA-256 hashing. POST create/update regression tests reject whitespace-only content without changing optional-update behavior.

The evaluator compares MAX, MEAN and the former prefix result on the same inputs. Software invariants fail explicitly; relative semantic comparisons are observations, not calibrated accuracy claims or enforcement gates. It exercises the real processor and classifier with a mocked input-fetch response. The separate live E2E checks authenticated HTTP, Kafka, persistence and durable policy execution.

## Offline worker checks

From `moderation-worker` in PowerShell, with Docker Desktop available:

```powershell
docker build -t gachahub-moderation-worker:chunked .
$workerRoot = (Get-Location).Path
docker run --rm --network none -e RUN_REAL_MODEL_TESTS=1 --mount "type=bind,source=$workerRoot\tests,target=/app/tests,readonly" --entrypoint python gachahub-moderation-worker:chunked -m unittest discover -s tests -p 'test_*.py' -v

# Optional full comparison; generated output stays local and ignored.
New-Item -ItemType Directory -Force .validation | Out-Null
$resultRoot = Join-Path $workerRoot '.validation'
docker run --rm --network none --mount "type=bind,source=$workerRoot\tests,target=/app/tests,readonly" --mount "type=bind,source=$resultRoot,target=/results" --entrypoint python gachahub-moderation-worker:chunked -m app.evaluation.validate_toxicity --output /results/chunked.json
```

Application code and pinned weights come from the image; only current tests/fixtures and optional output are mounted. Runtime uses the baked cache with `HF_HUB_OFFLINE=1`; no host model cache or Hugging Face network access is needed. RSS collection in the optional evaluator targets Linux Docker. The old nine-sample smoke evaluator is superseded by this shared corpus/tool.

## Backend and live checks

From `backend`:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns='moderation-(analysis|policy)'
```

For the live E2E, provide an explicitly disposable loopback `MODERATION_TEST_DATABASE_URL`, matching `DATABASE_URL`, local Kafka, and the existing worker venv with the pinned model cached. Set `HF_HUB_OFFLINE=1` and `RUN_MODERATION_REAL_MODEL_LIVE=1`, then run `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand moderation-worker-live.e2e-spec.ts`. Randomized schemas/topics/groups isolate test data. Do not use an application database. Kafka/HTTP require the local network even though model inference is offline.

## Limits before enforcement

Coverage is complete at the token level, not guaranteed semantic detection. Window boundaries, neutral surrounding text and indirect wording can weaken harmful scores. MAX can increase gaming/fiction/quotation false positives as more text is examined. The model does not reliably distinguish real-world intent from context. Work is capped, but no hard wall-clock deadline is introduced; pathological inputs can cost more than ordinary posts. Keep human review and evaluate these limitations before automatic enforcement.
