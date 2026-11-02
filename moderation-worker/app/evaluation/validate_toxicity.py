"""Offline production worker path validation and quality observations, no thresholds."""
import argparse
import hashlib
import json
import os
import statistics
import time
from pathlib import Path
from threading import Event
from unittest.mock import Mock
from uuid import NAMESPACE_URL, uuid5

from app.classifiers.model_profile import HUGGINGFACE_PROFILE, MODEL_MAX_LENGTH, MODEL_NAME, MODEL_REVISION
from app.contracts.moderation import MAX_CONTENT_CODEPOINTS, TEXT_INPUT_SCHEMA_VERSION, ModerationInputResponse, ModerationResultEvent, PostInput, normalize_text, snapshot_hash
from app.evaluation.toxicity_reference import FIXTURE, LABELS, relative_observations, samples, coverage_samples, validate_output
from app.classifiers.chunking import prepare_chunks
from app.processing.job_processor import JobProcessor


def memory():
    import resource
    current = int(next(line.split()[1] for line in Path('/proc/self/status').read_text().splitlines()
                       if line.startswith('VmRSS:')))
    return dict(rss_mib=current / 1024, peak_rss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)


def process_sample(classifier, sample):
    snapshot = PostInput(type="POST", title=normalize_text(sample.get("title", ""), 300) or None,
                         content=normalize_text(sample["text"], MAX_CONTENT_CODEPOINTS))
    identity = dict(analysisJobId="reference-" + sample["id"], caseId="reference-case", generation=1,
                    targetType="POST", targetId="reference-post", snapshotHash=snapshot_hash(snapshot),
                    inputSchemaVersion=TEXT_INPUT_SCHEMA_VERSION, classifierProfile=HUGGINGFACE_PROFILE)
    backend = Mock()
    backend.get_analysis_input.return_value = ModerationInputResponse(**identity, input=snapshot)
    request = dict(eventId=str(uuid5(NAMESPACE_URL, sample["id"])), type="moderation.analysis.requested", version=1,
                   occurredAt="2026-10-29T00:00:00Z", aggregateId="reference-case", payload=identity)
    started = time.perf_counter()
    result = JobProcessor(backend, classifier, HUGGINGFACE_PROFILE).process(json.dumps(request).encode(), Event())
    elapsed = time.perf_counter() - started
    # Exercise serialization/deserialization of the actual production result contract.
    restored = ModerationResultEvent.model_validate_json(result.model_dump_json())
    if restored.payload.status != "SUCCEEDED" or restored.payload.classifierProfile != HUGGINGFACE_PROFILE:
        raise AssertionError("Production worker path failed")
    scores = validate_output(restored.payload.output)
    text = (snapshot.title + "\n\n" if snapshot.title else "") + snapshot.content
    return snapshot, text, restored, scores, elapsed


def run():
    report = dict(model=MODEL_NAME, revision=MODEL_REVISION, profile=HUGGINGFACE_PROFILE,
                  fixture_sha256=hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
                  max_tokens=MODEL_MAX_LENGTH, offline=os.getenv("HF_HUB_OFFLINE"), idle=memory(), rows=[])
    import torch
    import transformers
    from app.classifiers.huggingface import HuggingFaceClassifier
    torch.set_num_threads(2)
    report.update(torch=torch.__version__, transformers=transformers.__version__, threads=2)
    start = time.perf_counter()
    classifier = HuggingFaceClassifier()
    report.update(load_seconds=time.perf_counter() - start, loaded=memory(),
                  model_dtype=str(next(classifier.model.parameters()).dtype))
    # Instrument the real inference call to compare MAX/MEAN on identical logits,
    # without running every long input a second time just for aggregation analysis.
    observed_chunks = []
    score_chunks = classifier._chunk_scores
    def observe(*args, **kwargs):
        result = score_chunks(*args, **kwargs)
        observed_chunks.append(result)
        return result
    classifier._chunk_scores = observe
    for sample in [*samples(), *coverage_samples()]:
        observed_chunks.clear()
        snapshot, text, result, scores, elapsed = process_sample(classifier, sample)
        tokenized = classifier.tokenizer(text, truncation=False)
        bounded = classifier.tokenizer(text, truncation=True, max_length=MODEL_MAX_LENGTH)
        chunks = prepare_chunks(classifier.tokenizer, text, MODEL_MAX_LENGTH)
        with torch.inference_mode():
            legacy_inputs = classifier.tokenizer(text, return_tensors="pt", truncation=True, max_length=MODEL_MAX_LENGTH)
            legacy = torch.sigmoid(classifier.model(**legacy_inputs).logits[0]).tolist()
        mean = scores if chunks is None else dict(zip(LABELS, observed_chunks[-1].mean(dim=0).tolist(), strict=True))
        if chunks is None and max(abs(scores[key] - value) for key, value in zip(LABELS, legacy, strict=True)) > 1e-6:
            raise AssertionError("Short input differs from legacy inference")
        report["rows"].append({**sample, "canonical_input": snapshot.model_dump(), "snapshot_hash": result.payload.snapshotHash,
                               "result_event_id": result.eventId, "scores": scores, "seconds": elapsed,
                               "source_codepoints": len(sample["text"]), "model_text_codepoints": len(text),
                               "full_tokens": len(tokenized["input_ids"]), "used_tokens": len(bounded["input_ids"]),
                               "chunks": len(chunks) if chunks else 1,
                               "legacy_prefix_scores": dict(zip(LABELS, legacy, strict=True)), "mean_scores": mean,
                               "memory": memory()})
        print(json.dumps(dict(completed=sample["id"], seconds=elapsed)), flush=True)
    report["relative_observations"] = relative_observations(report["rows"])
    report["aggregates"] = []
    for language in ("en", "vi"):
        for cohort in ("benign", "toxic", "threat", "gaming_violence"):
            rows = [r for r in report["rows"] if r["language"] == language and r["cohort"] == cohort]
            report["aggregates"].append(dict(language=language, cohort=cohort, count=len(rows),
                mean_scores={label: statistics.mean(r["scores"][label] for r in rows) for label in LABELS}))
    report["final_memory"] = memory()
    benchmark = next(row for row in samples() if row["id"] == "neutral_long-en")["text"][:6000]
    chunks = prepare_chunks(classifier.tokenizer, benchmark, MODEL_MAX_LENGTH)
    report["batch_comparison"] = {}
    for size in (1, 4):
        started = time.perf_counter()
        classifier._chunk_scores(chunks, batch_size=size)
        report["batch_comparison"][str(size)] = time.perf_counter() - started
    report["latency_seconds"] = {"median": statistics.median(r["seconds"] for r in report["rows"]),
                                 "max": max(r["seconds"] for r in report["rows"])}
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(run(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
