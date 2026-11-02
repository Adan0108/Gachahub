"""Immutable Stage 2E model/preprocessing bundle (no weights in the repository)."""

MODEL_NAME = "Horizon-Labs/multilingual-toxicity-small"
MODEL_REVISION = "01adcc628a33848569816d4851a38544c321b92c"
# Fine-tuning used 256 tokens; the base/tokenizer capacity of 8192 is not the
# intended toxicity input length. Includes tokenizer-added special tokens.
MODEL_MAX_LENGTH = 256
HUGGINGFACE_PROFILE = "toxicity-mmbert-small-v1"
FIXTURE_PROFILE = "moderation-text-v1"
