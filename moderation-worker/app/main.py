import logging
import signal

from pydantic import ValidationError

from .backend_client import ModerationInputClient
from .classifier import FixtureClassifier
from .config import Settings
from .errors import SecurityFailure
from .kafka_consumer import Worker, create_consumer, log_event
from .kafka_producer import ConfirmedPublisher, create_producer
from .processing import JobProcessor


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    backend = None
    consumer = None
    publisher = None
    worker = None
    try:
        settings = Settings.from_env()
        backend = ModerationInputClient(settings)
        publisher = ConfirmedPublisher(create_producer(settings), settings)
        consumer = create_consumer(settings)
        worker = Worker(consumer, publisher, JobProcessor(backend, FixtureClassifier()), settings)
        signal.signal(signal.SIGINT, worker.stop)
        signal.signal(signal.SIGTERM, worker.stop)
        worker.run()
        return 0
    except ValidationError:
        log_event("configuration_invalid", level=logging.ERROR)
    except SecurityFailure:
        log_event("service_authentication_failed", level=logging.ERROR)
    except Exception:
        # No exception messages/stacks: HTTP errors can contain URLs or private bodies.
        log_event("worker_failed_request_uncommitted", level=logging.ERROR)
    finally:
        if backend:
            backend.close()
        if worker is None:
            if consumer:
                consumer.close()
            if publisher:
                publisher.close()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
