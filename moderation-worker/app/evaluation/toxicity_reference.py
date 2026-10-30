"""Production-model screening corpus and invariants; no moderation decisions."""
import json
from pathlib import Path

from app.classifiers.model_profile import MODEL_NAME, MODEL_REVISION
from app.contracts.moderation import MAX_CONTENT_CODEPOINTS, ClassifierOutput

LABELS = ("toxicity", "severe_toxicity", "obscene", "threat", "insult", "identity_attack", "sexual_explicit")
FIXTURE = Path(__file__).resolve().parents[2] / "tests/fixtures/toxicity-reference-v1.json"


def repeated_prefix(phrase, length):
    return (phrase * (length // len(phrase) + 1))[:length]


def samples():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rows = []
    for category, cohort, en, vi in fixture["pairs"]:
        for language, text in (("en", en), ("vi", vi)):
            rows.append(dict(id=f"{category}-{language}", category=category, cohort=cohort, language=language, text=text))
    for category, text in fixture["short"]:
        rows.append(dict(id=f"short-{category}", category="short", cohort="other", language="und", text=text))
    for language in ("en", "vi"):
        neutral, toxic = (fixture["long_recipes"][f"{kind}_{language}"] for kind in ("neutral", "toxic"))
        for category, text in (
            ("medium", repeated_prefix(neutral, 1200)),
            ("neutral_long", repeated_prefix(neutral, 18000)),
            ("toxic_long", repeated_prefix(toxic, 18000)),
            ("repeated", ("GG! " if language == "en" else "Hay! ") * 1000),
            ("long_start", toxic + repeated_prefix(neutral, 18000)),
            ("long_middle", repeated_prefix(neutral, 9000) + toxic + repeated_prefix(neutral, 9000)),
            ("long_end", repeated_prefix(neutral, 18000) + toxic),
            ("canonical_max", repeated_prefix(neutral, MAX_CONTENT_CODEPOINTS)),
        ):
            row = dict(id=f"{category}-{language}", category=category, cohort="long", language=language, text=text)
            if category == "canonical_max":
                row["title"] = "T" * 300
            rows.append(row)
    return rows


def validate_output(output):
    parsed = ClassifierOutput.model_validate(output)
    if (parsed.model.name, parsed.model.revision) != (MODEL_NAME, MODEL_REVISION):
        raise ValueError("Incorrect production model identity")
    if tuple(label.label for label in parsed.labels) != LABELS:
        raise ValueError("Incorrect production taxonomy or ordering")
    return {item.label: item.score for item in parsed.labels}


def relative_observations(rows):
    by_id = {row["id"]: row for row in rows}
    observations = []
    for language in ("en", "vi"):
        for category, label in (("strong_insult", "insult"), ("strong_insult", "toxicity"),
                                ("direct_threat", "threat"), ("sexual", "sexual_explicit"),
                                ("identity_abuse", "identity_attack")):
            target, control = by_id[f"{category}-{language}"], by_id[f"benign-{language}"]
            observations.append(dict(language=language, target=target["id"], control=control["id"], label=label,
                                     target_score=target["scores"][label], control_score=control["scores"][label],
                                     higher_than_control=target["scores"][label] > control["scores"][label]))
    return observations


def coverage_samples():
    """45 same-sentence position contrasts plus six realistic benign gaming controls."""
    by_id = {row["id"]: row for row in samples()}
    for language in ("en", "vi", "mixed"):
        neutral = ("This guide lists equipment costs and upgrade schedules. " if language == "en" else
                   "Bài hướng dẫn liệt kê trang bị và lịch nâng cấp. " if language == "vi" else
                   "This guide liệt kê trang bị và upgrade schedules. ")
        for category, label in (("direct_threat", "threat"), ("strong_insult", "insult"),
                                ("severe", "severe_toxicity"), ("sexual", "sexual_explicit"),
                                ("identity_abuse", "identity_attack")):
            phrase = by_id[f"{category}-{'vi' if language == 'vi' else 'en'}"]["text"]
            if language == "mixed":
                phrase += " " + by_id[f"{category}-vi"]["text"]
            for position, prefix_size in (("beginning", 0), ("middle", 9000), ("end", 18000)):
                text = repeated_prefix(neutral, prefix_size) + "\n" + phrase + "\n" + repeated_prefix(neutral, 18000 - prefix_size)
                yield dict(id=f"coverage-{category}-{position}-{language}", category="coverage", cohort="coverage",
                           language=language, text=text, signal_label=label, signal_position=position)
    controls = (
        ("guide", "Upgrade equipment gradually and save resources for your favorite characters. "),
        ("pvp", "In PvP, focus the enemy healer, then retreat and respawn if your team loses the fight. "),
        ("boss", "Kill the boss before phase two. Dodge its attack and revive fallen teammates. "),
        ("lore", "In the fictional story, the villain kills the village guards; the hero later defeats the villain. "),
        ("review", "The game has beautiful art, enjoyable combat, clear menus and a generous soundtrack. "),
        ("community", "Thanks for the guide. Please share your team builds and welcome new players to our community. "),
    )
    for name, phrase in controls:
        yield dict(id=f"benign-long-{name}", category="benign_long", cohort="benign_long", language="en",
                   text=repeated_prefix(phrase, 18000))
