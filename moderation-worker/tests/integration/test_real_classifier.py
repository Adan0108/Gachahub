import math
import os
import unittest

from app.classifiers.huggingface import HuggingFaceClassifier
from app.classifiers.model_profile import MODEL_NAME, MODEL_REVISION
from tests.unit.test_classifier import LABELS


@unittest.skipUnless(os.environ.get("RUN_REAL_MODEL_TESTS") == "1", "opt-in real model download/inference")
class RealModelTests(unittest.TestCase):
    def test_full_30000_post_tail_is_inferred_with_per_label_max(self):
        from unittest.mock import patch
        text = "T" * 300 + "\n\n" + "a " * 14985 + "I will kill you tonight.".ljust(30, "!")
        self.assertEqual(len(text), 30302)
        with patch.object(self.classifier, "_chunk_scores", wraps=self.classifier._chunk_scores) as score:
            output = self.classifier.classify(text)
            chunks = score.call_args.args[0]
            tokens = self.classifier.tokenizer(text, add_special_tokens=False)["input_ids"]
            self.assertEqual(chunks[-1]["input_ids"][-2], tokens[-1])
            self.assertGreater(len(chunks), 1)
        # Explicitly compare all seven MAX outputs to the same window inference.
        expected = self.classifier._chunk_scores(chunks).amax(dim=0).tolist()
        self.assertEqual([entry.score for entry in output.labels], expected)

    @classmethod
    def setUpClass(cls):
        import torch
        torch.set_num_threads(2)
        cls.classifier = HuggingFaceClassifier()

    def test_actual_labels_finite_scores_determinism_truncation_and_empty_input(self):
        import torch

        classifier = self.classifier
        self.assertEqual(classifier.labels, LABELS)
        self.assertEqual(classifier.tokenizer.truncation_side, "right")
        for text in ("Thanks for helping!", "Cảm ơn bạn!", "", "   ", "game " * 4000):
            with self.subTest(length=len(text)):
                first, second = classifier.classify(text), classifier.classify(text)
                self.assertEqual(first.model.name, MODEL_NAME)
                self.assertEqual(first.model.revision, MODEL_REVISION)
                self.assertEqual(tuple(item.label for item in first.labels), LABELS)
                self.assertTrue(all(math.isfinite(item.score) and 0 <= item.score <= 1 for item in first.labels))
                torch.testing.assert_close(torch.tensor([item.score for item in first.labels]),
                                           torch.tensor([item.score for item in second.labels]), rtol=1e-5, atol=1e-6)
        encoded = classifier.tokenizer("game " * 10000, return_tensors="pt", truncation=True, max_length=256)
        self.assertEqual(encoded["input_ids"].shape[-1], 256)
        self.assertFalse(classifier.model.training)

    def test_broad_corpus_through_verified_processor_and_serialized_result(self):
        from app.evaluation.toxicity_reference import samples, validate_output
        from app.evaluation.validate_toxicity import process_sample
        for sample in samples():
            with self.subTest(sample["id"]):
                snapshot, _, event, scores, _ = process_sample(self.classifier, sample)
                self.assertEqual(tuple(scores), LABELS)
                self.assertEqual(validate_output(event.payload.output), scores)
                from app.contracts.moderation import snapshot_hash
                self.assertEqual(event.payload.snapshotHash, snapshot_hash(snapshot))

    def test_real_reference_sigmoid_and_preprocessing_match_transformers(self):
        from transformers import pipeline
        reference = pipeline("text-classification", model=self.classifier.model,
                             tokenizer=self.classifier.tokenizer, device=-1)
        for text in ("I will kill you.", "Tao sẽ giết mày ngoài đời.", "Thanks for helping!", "", "   "):
            actual = {item.label: item.score for item in self.classifier.classify(text).labels}
            expected = reference(text, top_k=None, function_to_apply="sigmoid", truncation=True, max_length=256)
            self.assertEqual(set(actual), {item["label"] for item in expected})
            for item in expected:
                self.assertAlmostEqual(actual[item["label"]], item["score"], places=6)

    def test_real_chunks_cover_threats_hidden_from_legacy_prefix(self):
        from app.evaluation.toxicity_reference import samples
        by_id = {r["id"]: r for r in samples()}
        from app.classifiers.chunking import prepare_chunks
        tokenizer = self.classifier.tokenizer
        for language in ("en", "vi"):
            neutral = by_id[f"neutral_long-{language}"]["text"]
            encoded = tokenizer(neutral, truncation=True, max_length=256)["input_ids"]
            expected = self.classifier.classify(neutral)
            for position in ("middle", "end"):
                text = by_id[f"long_{position}-{language}"]["text"]
                self.assertEqual(tokenizer(text, truncation=True, max_length=256)["input_ids"], encoded)
                chunks = prepare_chunks(tokenizer, text, 256)
                self.assertGreater(len(chunks), 1)
                scores = {r.label: r.score for r in self.classifier.classify(text).labels}
                control = {r.label: r.score for r in expected.labels}
                # A relative signal observation; no policy/enforcement threshold.
                self.assertGreater(scores["threat"], control["threat"])
            beginning = by_id[f"long_start-{language}"]["text"]
            self.assertNotEqual(tokenizer(beginning, truncation=True, max_length=256)["input_ids"], encoded)
        # Check exact tokenizer boundaries without assuming tokens equal words.
        ids = tokenizer("hello " * 1000, add_special_tokens=False)["input_ids"]
        for size in (253, 254, 255):
            text = tokenizer.decode(ids[:size])
            full = tokenizer(text)["input_ids"]
            self.assertEqual(len(full), size + 2)
            self.assertEqual(len(tokenizer(text, truncation=True, max_length=256)["input_ids"]), min(size + 2, 256))

    def test_canonical_equivalents_have_identical_real_scores(self):
        import unicodedata
        from app.contracts.moderation import MAX_CONTENT_CODEPOINTS, normalize_text
        text = "Cảm ơn bạn 😀\nHướng dẫn rất hữu ích."
        baseline = self.classifier.classify(text)
        for variant in (unicodedata.normalize("NFD", text), " \t" + text + "\n ",
                        text.replace("\n", "\r\n"), text.replace("\n", "\r")):
            self.assertEqual(self.classifier.classify(normalize_text(variant, MAX_CONTENT_CODEPOINTS)), baseline)

    def test_actual_tokenizer_work_bound_and_title_tail_coverage(self):
        from app.classifiers.chunking import MAX_POST_CODEPOINTS, prepare_chunks
        # Unicode scalar with byte fallback: exercise the expansion bound, not just Latin words.
        chunks = prepare_chunks(self.classifier.tokenizer, "\U0010ffff" * MAX_POST_CODEPOINTS, 256)
        self.assertLessEqual(len(chunks), 638)
        text = "T" * 300 + "\n\n" + "guide " * 3000 + "I will kill you tonight."
        chunks = prepare_chunks(self.classifier.tokenizer, text, 256)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0]["input_ids"], self.classifier.tokenizer(
            text, truncation=True, max_length=256)["input_ids"])

