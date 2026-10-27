from .contracts import ClassifierOutput, ModelIdentity, ModerationLabel
from .model_profile import MODEL_MAX_LENGTH, MODEL_NAME, MODEL_REVISION


class HuggingFaceClassifier:
    """One local CPU model per worker; no policy, thresholds or text logging."""

    def __init__(self, model_name=MODEL_NAME, revision=MODEL_REVISION, max_length=MODEL_MAX_LENGTH):
        if (model_name, revision, max_length) != (MODEL_NAME, MODEL_REVISION, MODEL_MAX_LENGTH):
            raise ValueError("Model settings must match the immutable classifier profile")
        # Lazy imports keep fixture-only tests independent of Torch/Transformers.
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self._torch = torch
        self.max_length = max_length
        self.identity = ModelIdentity(name=model_name, revision=revision)
        self.tokenizer = AutoTokenizer.from_pretrained(model_name, revision=revision, trust_remote_code=False)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            model_name, revision=revision, trust_remote_code=False, use_safetensors=True,
            attn_implementation="eager",
        )
        self.model.to("cpu")
        self.model.eval()
        config = self.model.config
        if config.problem_type != "multi_label_classification":
            raise ValueError("Expected a multi-label sequence classifier")
        if max_length > min(config.max_position_embeddings, self.tokenizer.model_max_length):
            raise ValueError("Classifier length exceeds model/tokenizer capacity")
        self.labels = tuple(config.id2label[index] for index in range(config.num_labels))
        # Validate taxonomy against the existing normalized contract at startup.
        ClassifierOutput(model=self.identity, labels=[ModerationLabel(label=label, score=0.0)
                                                     for label in self.labels])

    def classify(self, text: str) -> ClassifierOutput:
        # Preserve the pipeline's exact text (including representable empty input).
        inputs = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=self.max_length)
        with self._torch.inference_mode():
            logits = self.model(**inputs).logits
            if tuple(logits.shape) != (1, len(self.labels)) or not self._torch.isfinite(logits).all().item():
                raise ValueError("Invalid classifier logits")
            scores = self._torch.sigmoid(logits[0]).tolist()
        # Pydantic rejects nonfinite or out-of-range probabilities; no clamping.
        return ClassifierOutput(model=self.identity, labels=[
            ModerationLabel(label=label, score=score) for label, score in zip(self.labels, scores, strict=True)
        ])
