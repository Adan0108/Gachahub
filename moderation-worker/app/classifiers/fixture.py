from app.contracts.moderation import ClassifierOutput, ModelIdentity, ModerationLabel


class FixtureClassifier:
    def classify(self, text: str) -> ClassifierOutput:
        normalized = text.lower()
        return ClassifierOutput(
            model=ModelIdentity(name="fixture-text", revision="v1"),
            labels=[ModerationLabel(label="toxicity", score=0.9 if "fixture-toxic" in normalized else 0.1),
                    ModerationLabel(label="violence", score=0.8 if "fixture-violence" in normalized else 0.05)],
        )
