from typing import Protocol

from app.contracts.moderation import ClassifierOutput


class Classifier(Protocol):
    def classify(self, text: str) -> ClassifierOutput: ...


def create_classifier(settings) -> Classifier:
    if settings.classifier_backend == "fixture":
        from .fixture import FixtureClassifier

        return FixtureClassifier()
    if settings.classifier_backend == "huggingface":
        from app.classifiers.huggingface import HuggingFaceClassifier
        from app.classifiers.deadline import DeadlineClassifier

        return DeadlineClassifier(HuggingFaceClassifier,
                                  (settings.classifier_model_name, settings.classifier_model_revision,
                                   settings.classifier_max_length), settings.classifier_timeout_seconds,
                                  settings.classifier_startup_timeout_seconds)
    raise ValueError("Unsupported classifier backend")
