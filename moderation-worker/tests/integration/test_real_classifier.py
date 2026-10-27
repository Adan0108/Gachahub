import math
import os
import unittest

from app.classifiers.huggingface import HuggingFaceClassifier
from app.classifiers.model_profile import MODEL_NAME, MODEL_REVISION
from tests.unit.test_classifier import LABELS


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
        for text in ("Thanks for helping!", "CÃ¡ÂºÂ£m Ã†Â¡n bÃ¡ÂºÂ¡n!", "", "   ", "game " * 10000):
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

