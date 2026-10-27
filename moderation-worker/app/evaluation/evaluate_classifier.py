"""Standalone observation only: python -m app.evaluation.evaluate_classifier (no backend/Kafka)."""
import json
import time

from app.classifiers.huggingface import HuggingFaceClassifier

SAMPLES = (
    ("en", "benign praise", "Thanks for sharing, this guide was really helpful!"),
    ("en", "insult", "You are a complete idiot and nobody wants you here."),
    ("en", "threat", "I will find you and kill you."),
    ("en", "sexual/obscene", "Fuck off with your fucking porn and sex spam."),
    ("vi", "benign praise", "Cảm ơn bạn, bài hướng dẫn này rất hữu ích!"),
    ("vi", "insult", "Mày là đồ ngu, chẳng ai muốn nói chuyện với mày."),
    ("vi", "threat", "Tao sẽ tìm đến nhà và giết mày."),
    ("vi", "profanity", "Địt mẹ mày, cút đi!"),
    ("vi", "ambiguous gaming violence", "Tối nay vào game giết boss rồi bắn hạ đội địch nhé."),
)


def main():
    started = time.perf_counter()
    classifier = HuggingFaceClassifier()
    print(json.dumps({"model": classifier.identity.model_dump(), "max_length": classifier.max_length,
                      "load_seconds": round(time.perf_counter() - started, 3)}), flush=True)
    for language, category, text in SAMPLES:
        started = time.perf_counter()
        output = classifier.classify(text)
        print(json.dumps({"language": language, "category": category, "text": text,
                          "seconds": round(time.perf_counter() - started, 3),
                          "labels": [label.model_dump() for label in output.labels]}, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
