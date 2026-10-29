import unicodedata
import unittest
from unittest.mock import Mock

from pydantic import ValidationError
from app.contracts.moderation import CommentInput, PostInput, normalize_text, snapshot_hash
from app.evaluation.toxicity_reference import LABELS, samples, validate_output
from app.evaluation.validate_toxicity import process_sample
from app.classifiers.model_profile import MODEL_NAME, MODEL_REVISION


class ToxicityReferenceTests(unittest.TestCase):
    def test_corpus_coverage_ids_and_bounds(self):
        rows = samples()
        self.assertEqual(len(rows), 72)
        self.assertEqual(len({r["id"] for r in rows}), len(rows))
        self.assertEqual({r["language"] for r in rows}, {"en", "vi", "und"})
        self.assertGreaterEqual(len({r["category"] for r in rows}), 30)
        for row in rows:
            snapshot = PostInput(type="POST", title=normalize_text(row.get("title", ""), 300) or None,
                                 content=normalize_text(row["text"], 20000))
            self.assertLessEqual(len(snapshot.content), 20000)
        for language in ("en", "vi"):
            maximum = next(r for r in rows if r["id"] == f"canonical_max-{language}")
            self.assertEqual(len(normalize_text(maximum["text"], 20000)), 20000)

    def test_evaluation_contract_catches_wrong_labels_and_identity(self):
        output = {"model": {"name": MODEL_NAME, "revision": MODEL_REVISION},
                  "labels": [{"label": label, "score": .5} for label in LABELS]}
        self.assertEqual(tuple(validate_output(output)), LABELS)
        for change in ({"model": {"name": MODEL_NAME, "revision": "main"}},
                       {"labels": output["labels"][:-1]}, {"labels": list(reversed(output["labels"]))}):
            with self.assertRaises(ValueError):
                validate_output({**output, **change})

    def test_correct_vietnamese_canonical_equivalence(self):
        text = "Tiếng Việt: cảm ơn bạn 😀\nDòng thứ hai."
        variants = [text, unicodedata.normalize("NFD", text), text.replace("\n", "\r\n"),
                    text.replace("\n", "\r"), " \t\ufeff" + text + "\n "]
        snapshots = [CommentInput(type="COMMENT", content=normalize_text(v, 20000)) for v in variants]
        self.assertEqual(len({snapshot_hash(s) for s in snapshots}), 1)
        self.assertTrue(all(s.content == text for s in snapshots))
        with self.assertRaises(ValidationError):
            CommentInput(type="COMMENT", content=unicodedata.normalize("NFD", text))

    def test_processor_title_and_canonical_content_without_semantic_thresholds(self):
        classifier = Mock()
        classifier.classify.return_value = {"model": {"name": MODEL_NAME, "revision": MODEL_REVISION},
            "labels": [{"label": label, "score": .5} for label in LABELS]}
        snapshot, text, event, _, _ = process_sample(classifier, {
            "id": "canonical-check", "title": " Tiêu đề ", "text": " Cảm ơn\r\nbạn 😀 "})
        self.assertEqual(text, "Tiêu đề\n\nCảm ơn\nbạn 😀")
        classifier.classify.assert_called_once_with(text)
        self.assertEqual(event.payload.snapshotHash, snapshot_hash(snapshot))
        self.assertEqual(event.payload.classifierProfile, "toxicity-mmbert-small-v1")
