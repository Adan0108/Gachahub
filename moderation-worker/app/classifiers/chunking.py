"""Deterministic work limits for the pinned BPE/metaspace tokenizer."""
import json
import math
from app.contracts.moderation import MAX_CONTENT_CODEPOINTS

WINDOW_OVERLAP = 64
CHUNK_BATCH_SIZE = 4
# Canonical POST: title + two newlines + content. COMMENT: content only.
MAX_POST_CODEPOINTS = 300 + 2 + MAX_CONTENT_CODEPOINTS
MAX_COMMENT_CODEPOINTS = MAX_CONTENT_CODEPOINTS


def token_budget(codepoints):
    # Replace ASCII space with U+2581 (3 bytes), then prepend one metaspace.
    # Every Unicode scalar encodes to <=4 bytes. Byte-fallback BPE merges can
    # only reduce this upper bound; there is no expanding Unicode normalizer.
    return 4 * codepoints + 3


def max_chunks(codepoints, payload, overlap=WINDOW_OVERLAP):
    if not 0 <= overlap < payload:
        raise ValueError("Invalid overlap")
    return 1 + max(0, math.ceil((token_budget(codepoints) - payload) / (payload - overlap)))


def verify_tokenizer(tokenizer):
    config = json.loads(tokenizer.backend_tokenizer.to_str())
    if config["normalizer"] != {"type": "Replace", "pattern": {"String": " "}, "content": "▁"}:
        raise ValueError("Unsupported tokenizer normalization for work bound")
    if config["pre_tokenizer"] != {"type": "Metaspace", "replacement": "▁", "prepend_scheme": "always", "split": True}:
        raise ValueError("Unsupported pre-tokenizer for work bound")
    if config["model"]["type"] != "BPE":
        raise ValueError("Unsupported tokenizer model for work bound")


def prepare_chunks(tokenizer, text, window):
    if not isinstance(text, str) or len(text) > MAX_POST_CODEPOINTS or "\0" in text:
        raise ValueError("Classifier input exceeds canonical bounds")
    text.encode("utf-8", errors="strict")  # Reject lone surrogates before tokenization.
    special = tokenizer.num_special_tokens_to_add(pair=False)
    payload = window - special
    if payload <= WINDOW_OVERLAP:
        raise ValueError("Model window cannot accommodate overlap")
    tokens = tokenizer(text, add_special_tokens=False, truncation=False)["input_ids"]
    if len(tokens) > token_budget(len(text)):
        raise ValueError("Tokenizer exceeded verified expansion bound")
    if len(tokens) <= payload:
        return None  # Preserve the exact legacy one-window preprocessing path.
    encoded = tokenizer(text, truncation=True, max_length=window, stride=WINDOW_OVERLAP,
                        return_overflowing_tokens=True, return_special_tokens_mask=True)
    if len(encoded["input_ids"]) > max_chunks(MAX_POST_CODEPOINTS, payload):
        raise ValueError("Chunk work limit exceeded")
    chunks, covered = [], []
    for index, ids in enumerate(encoded["input_ids"]):
        mask = encoded["special_tokens_mask"][index]
        part = [value for value, special_token in zip(ids, mask, strict=True) if not special_token]
        if len(ids) > window or not part:
            raise ValueError("Invalid tokenizer window")
        if index:
            if part[:WINDOW_OVERLAP] != covered[-WINDOW_OVERLAP:]:
                raise ValueError("Tokenizer overlap mismatch")
            covered.extend(part[WINDOW_OVERLAP:])
        else:
            covered.extend(part)
        chunks.append({key: encoded[key][index] for key in tokenizer.model_input_names if key in encoded})
    if covered != tokens:
        raise ValueError("Tokenizer windows do not cover the full input")
    return chunks
