import json
import math
import os
import unittest
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch

from pydantic import ValidationError

from app.classifier import FixtureClassifier, create_classifier
from app.contracts import ModerationInputResponse
from app.errors import QuarantineRequired
from app.huggingface_classifier import HuggingFaceClassifier
from app.model_profile import HUGGINGFACE_PROFILE, MODEL_MAX_LENGTH, MODEL_NAME, MODEL_REVISION
from app.processing import JobProcessor
from tests.test_worker import request, resolved, settings

LABELS = ("toxicity", "severe_toxicity", "obscene", "threat", "insult", "identity_attack", "sexual_explicit")


class FactoryTests(unittest.TestCase):
    def test_fixture_selected_and_unchanged(self):
        classifier = create_classifier(settings())
        self.assertIsInstance(classifier, FixtureClassifier)
        self.assertEqual(classifier.classify("fixture-toxic").labels[0].score, 0.9)
        self.assertEqual(classifier.classify("").model.name, "fixture-text")

    def test_huggingface_selected_with_pinned_settings(self):
        with patch("app.huggingface_classifier.HuggingFaceClassifier") as constructor:
            self.assertIs(create_classifier(settings(classifier_backend="huggingface")), constructor.return_value)
        constructor.assert_called_once_with(MODEL_NAME, MODEL_REVISION, MODEL_MAX_LENGTH)

    def test_immutable_profile_settings(self):
        self.assertEqual(settings(classifier_backend="huggingface").classifier_profile, HUGGINGFACE_PROFILE)
        for change in ({"classifier_backend": "other"}, {"classifier_model_revision": "main"},
                       {"classifier_model_revision": "a" * 40}, {"classifier_model_name": "other/model"},
                       {"classifier_max_length": 8192}):
            with self.subTest(change), self.assertRaises(ValidationError):
                settings(**change)

    def test_profile_mismatch_rejected_before_http(self):
        backend = Mock()
        proc = JobProcessor(backend, Mock(), HUGGINGFACE_PROFILE)
        with self.assertRaises(QuarantineRequired):
            proc.process(json.dumps(request()).encode(), Event())
        backend.get_analysis_input.assert_not_called()

    def test_new_profile_preserves_pipeline_identity_and_model_output(self):
        event, response = request(), resolved()
        event["payload"]["classifierProfile"] = response["classifierProfile"] = HUGGINGFACE_PROFILE
        backend = Mock()
        backend.get_analysis_input.return_value = ModerationInputResponse.model_validate(response)
        classifier = Mock()
        classifier.classify.return_value = {"model": {"name": MODEL_NAME, "revision": MODEL_REVISION},
                                            "labels": [{"label": label, "score": 0.25} for label in LABELS]}
        result = JobProcessor(backend, classifier, HUGGINGFACE_PROFILE).process(json.dumps(event).encode(), Event())
        self.assertEqual(result.payload.status, "SUCCEEDED")
        self.assertEqual(result.payload.classifierProfile, HUGGINGFACE_PROFILE)
        self.assertEqual(result.payload.output.model.revision, MODEL_REVISION)


class ClassifierTests(unittest.TestCase):
    """Stub only the inference libraries; ordinary tests never download weights."""

    def setUp(self):
        self.torch = Mock()
        self.torch.inference_mode.return_value.__enter__ = Mock()
        self.torch.inference_mode.return_value.__exit__ = Mock(return_value=False)
        self.torch.isfinite.return_value.all.return_value.item.return_value = True
        self.torch.sigmoid.return_value.tolist.return_value = [0.25] * len(LABELS)
        self.transformers = Mock()
        self.tokenizer = self.transformers.AutoTokenizer.from_pretrained.return_value
        self.tokenizer.model_max_length = 8192
        self.tokenizer.return_value = {"input_ids": "bounded-tensor"}
        self.model = self.transformers.AutoModelForSequenceClassification.from_pretrained.return_value
        self.model.config = SimpleNamespace(problem_type="multi_label_classification", max_position_embeddings=8192,
                                            num_labels=len(LABELS), id2label=dict(enumerate(LABELS)))
        self.model.return_value.logits.shape = (1, len(LABELS))
        self.model.return_value.logits.__getitem__ = Mock()
        self.modules = patch.dict("sys.modules", {"torch": self.torch, "transformers": self.transformers})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def test_load_once_eval_cpu_and_pinned_revision(self):
        classifier = HuggingFaceClassifier()
        classifier.classify("hello")
        classifier.classify("hello again")
        self.transformers.AutoTokenizer.from_pretrained.assert_called_once_with(
            MODEL_NAME, revision=MODEL_REVISION, trust_remote_code=False)
        self.transformers.AutoModelForSequenceClassification.from_pretrained.assert_called_once_with(
            MODEL_NAME, revision=MODEL_REVISION, trust_remote_code=False, use_safetensors=True,
            attn_implementation="eager")
        self.model.eval.assert_called_once_with()
        self.model.to.assert_called_once_with("cpu")
        self.assertEqual(self.torch.inference_mode.call_count, 2)

    def test_labels_scores_repeatability_long_and_empty_text(self):
        classifier = HuggingFaceClassifier()
        for text in ("hello", "word " * 30000, "", "   "):
            with self.subTest(length=len(text)):
                output = classifier.classify(text)
                self.assertEqual(tuple(item.label for item in output.labels), LABELS)
                self.assertTrue(all(math.isfinite(item.score) and 0 <= item.score <= 1 for item in output.labels))
                self.assertEqual(classifier.classify(text), output)
                self.tokenizer.assert_called_with(text, return_tensors="pt", truncation=True, max_length=256)
        self.torch.sigmoid.assert_called()

    def test_reads_id2label_order(self):
        self.model.config.id2label = dict(enumerate(reversed(LABELS)))
        self.assertEqual(HuggingFaceClassifier().labels, tuple(reversed(LABELS)))

    def test_invalid_logits_fail_instead_of_clamping(self):
        classifier = HuggingFaceClassifier()
        self.torch.isfinite.return_value.all.return_value.item.return_value = False
        with self.assertRaises(ValueError):
            classifier.classify("hello")
        self.torch.isfinite.return_value.all.return_value.item.return_value = True
        self.model.return_value.logits.shape = (1, 1)
        with self.assertRaises(ValueError):
            classifier.classify("hello")

    def test_bad_probabilities_and_configuration_fail_closed(self):
        classifier = HuggingFaceClassifier()
        for score in (float("nan"), float("inf"), -0.1, 1.1):
            self.torch.sigmoid.return_value.tolist.return_value = [score] * len(LABELS)
            with self.assertRaises(ValidationError):
                classifier.classify("hello")
        self.model.config.problem_type = "single_label_classification"
        with self.assertRaises(ValueError):
            HuggingFaceClassifier()
        with self.assertRaises(ValueError):
            HuggingFaceClassifier(revision="main")


@unittest.skipUnless(os.environ.get("RUN_REAL_MODEL_TESTS") == "1", "opt-in real model download/inference")
class RealModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.classifier = HuggingFaceClassifier()

    def test_actual_labels_finite_scores_determinism_truncation_and_empty_input(self):
        import torch

        classifier = self.classifier
        self.assertEqual(classifier.labels, LABELS)
        self.assertEqual(classifier.tokenizer.truncation_side, "right")
        for text in ("Thanks for helping!", "Cảm ơn bạn!", "", "   ", "game " * 10000):
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


if __name__ == "__main__":
    unittest.main()
