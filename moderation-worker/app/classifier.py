from typing import Protocol

from .contracts import ClassifierOutput, ModelIdentity, ModerationLabel


class Classifier(Protocol):
    def classify(self, text: str) -> ClassifierOutput: ...


class FixtureClassifier:
    def classify(self, text: str) -> ClassifierOutput:
        normalized = text.lower()
        return ClassifierOutput(
            model=ModelIdentity(name="fixture-text", revision="v1"),
            labels=[ModerationLabel(label="toxicity", score=0.9 if "fixture-toxic" in normalized else 0.1),
                    ModerationLabel(label="violence", score=0.8 if "fixture-violence" in normalized else 0.05)],
        )


def create_classifier(settings) -> Classifier:
    if settings.classifier_backend == "fixture":
        return FixtureClassifier()
    if settings.classifier_backend == "huggingface":
        from .huggingface_classifier import HuggingFaceClassifier

        return HuggingFaceClassifier(settings.classifier_model_name, settings.classifier_model_revision,
                                    settings.classifier_max_length)
    raise ValueError("Unsupported classifier backend")
