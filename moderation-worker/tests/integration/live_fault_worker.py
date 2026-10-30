"""Test-only fault injection around real transports; never use as the worker entry point."""
import os
import app.main as entry

if os.environ.get("LIVE_TEST_PUBLISH_BROKERS"):
    original_producer = entry.create_producer
    entry.create_producer = lambda settings: original_producer(settings.model_copy(update={"kafka_brokers": os.environ["LIVE_TEST_PUBLISH_BROKERS"]}))
if os.environ.get("LIVE_TEST_FAIL_COMMIT"):
    original_consumer = entry.create_consumer
    class FailBeforeCommit:
        def __init__(self, settings):
            self.consumer = original_consumer(settings)
        def __getattr__(self, name):
            return getattr(self.consumer, name)
        def commit(self, **_kwargs):
            raise RuntimeError("Test fault after acknowledged publication")
    entry.create_consumer = FailBeforeCommit
if __name__ == "__main__":
    raise SystemExit(entry.main())
