import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from app.classifiers.chunking import (
    MAX_POST_CODEPOINTS, MAX_COMMENT_CODEPOINTS, max_chunks,
    prepare_chunks, token_budget, verify_tokenizer,
)
from app.classifiers.huggingface import HuggingFaceClassifier
from app.classifiers.model_profile import MODEL_NAME, MODEL_REVISION
from app.contracts.moderation import ModelIdentity
from app.evaluation.toxicity_reference import LABELS


class Tokenizer:
    model_input_names = ["input_ids", "attention_mask"]

    def __init__(self, length):
        self.tokens = list(range(length))
        self.corrupt = False

    def num_special_tokens_to_add(self, pair=False):
        return 2

    def __call__(self, text, **kwargs):
        if not kwargs.get("return_overflowing_tokens"):
            return {"input_ids": self.tokens}
        ids, masks = [], []
        start = 0
        while True:
            part = self.tokens[start:start + 254]
            ids.append([-1] + part + [-2])
            masks.append([1] + [0] * len(part) + [1])
            if start + 254 >= len(self.tokens):
                break
            start += 190
        if self.corrupt:
            ids[-1][-2] = 999999
        return {"input_ids": ids, "special_tokens_mask": masks,
                "attention_mask": [[1] * len(row) for row in ids]}


class ChunkingTests(unittest.TestCase):
    def test_complete_deterministic_overlap_and_last_token(self):
        for length in (0, 254, 255, 444, 445, 1000, token_budget(MAX_POST_CODEPOINTS)):
            tokenizer = Tokenizer(length)
            chunks = prepare_chunks(tokenizer, "a" * MAX_POST_CODEPOINTS, 256)
            if length <= 254:
                self.assertIsNone(chunks)
                continue
            self.assertEqual(chunks, prepare_chunks(tokenizer, "a" * MAX_POST_CODEPOINTS, 256))
            reconstructed = chunks[0]["input_ids"][1:-1]
            for chunk in chunks[1:]:
                self.assertLessEqual(len(chunk["input_ids"]), 256)
                self.assertEqual(chunk["input_ids"][1:65], reconstructed[-64:])
                reconstructed.extend(chunk["input_ids"][65:-1])
            self.assertEqual(reconstructed, tokenizer.tokens)
        self.assertEqual(max_chunks(MAX_POST_CODEPOINTS, 254), 428)
        self.assertEqual(max_chunks(MAX_COMMENT_CODEPOINTS, 254), 421)

    def test_invalid_bounds_and_missing_tail_fail_instead_of_partial_success(self):
        for text in ("a" * (MAX_POST_CODEPOINTS + 1), "\0", "\ud800", None):
            with self.assertRaises((ValueError, UnicodeError)):
                prepare_chunks(Tokenizer(255), text, 256)
        tokenizer = Tokenizer(500)
        tokenizer.corrupt = True
        with self.assertRaises(ValueError):
            prepare_chunks(tokenizer, "a" * 500, 256)
        with self.assertRaises(ValueError):
            prepare_chunks(Tokenizer(1000), "a", 256)

    def test_tokenizer_expansion_assumptions_are_checked(self):
        config = {"normalizer": {"type": "Replace", "pattern": {"String": " "}, "content": "▁"},
                  "pre_tokenizer": {"type": "Metaspace", "replacement": "▁", "prepend_scheme": "always", "split": True},
                  "model": {"type": "BPE"}}
        tokenizer = Mock()
        tokenizer.backend_tokenizer.to_str.return_value = json.dumps(config)
        verify_tokenizer(tokenizer)
        config["normalizer"] = {"type": "NFKC"}
        tokenizer.backend_tokenizer.to_str.return_value = json.dumps(config)
        with self.assertRaises(ValueError):
            verify_tokenizer(tokenizer)

    def test_bounded_batch_max_preserves_any_harmful_chunk_and_failure_is_atomic(self):
        import torch
        classifier = HuggingFaceClassifier.__new__(HuggingFaceClassifier)
        classifier._torch = torch
        classifier.labels = LABELS
        classifier.identity = ModelIdentity(name=MODEL_NAME, revision=MODEL_REVISION)
        classifier.max_length = 256
        classifier.tokenizer = Tokenizer(1200)
        classifier.tokenizer.pad = Mock(side_effect=lambda batch, **kw: {"input_ids": torch.tensor([r["input_ids"][1] for r in batch])})
        # One harmful window, all others benign: means dilute; max must retain it.
        classifier.model = Mock(side_effect=lambda input_ids: SimpleNamespace(logits=torch.tensor([
            [5. if i == 950 else -5.] * 7 for i in input_ids.tolist()])))
        output = classifier.classify("a" * 1200)
        self.assertAlmostEqual(output.labels[0].score, torch.sigmoid(torch.tensor(5.)).item())
        self.assertEqual(classifier.model.call_count, 2)
        self.assertEqual([len(call.args[0]) for call in classifier.tokenizer.pad.call_args_list], [4, 2])
        classifier.model.side_effect = [SimpleNamespace(logits=torch.zeros(4, 7)), RuntimeError("batch failed")]
        with self.assertRaises(RuntimeError):
            classifier.classify("a" * 1200)
