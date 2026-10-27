from huggingface_hub import snapshot_download

from app.classifiers.model_profile import MODEL_NAME, MODEL_REVISION


def main() -> None:
    path = snapshot_download(
        repo_id=MODEL_NAME,
        revision=MODEL_REVISION,
        # Normal Transformers inference only; exclude ONNX exports/training data.
        allow_patterns=["config.json", "model.safetensors", "tokenizer.json",
                        "tokenizer_config.json", "special_tokens_map.json", "README.md", "LICENSE*"],
    )

    print(f"Cached model: {MODEL_NAME}")
    print(f"Revision: {MODEL_REVISION}")
    print(f"Path: {path}")


if __name__ == "__main__":
    main()
