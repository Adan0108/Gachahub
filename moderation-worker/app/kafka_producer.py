import hashlib
import json
import time
from uuid import NAMESPACE_URL, uuid5

from confluent_kafka import Producer

from .config import Settings
from .contracts import MAX_EVENT_BYTES, ModerationResultEvent
from .errors import Cancelled, DeliveryFailure


def create_producer(settings: Settings):
    return Producer({**settings.kafka_config(), "acks": "all", "enable.idempotence": True,
                     "delivery.timeout.ms": int(settings.delivery_timeout_seconds * 1000),
                     "request.timeout.ms": min(10000, int(settings.delivery_timeout_seconds * 1000)),
                     "queue.buffering.max.messages": 10, "log_level": 0})


class ConfirmedPublisher:
    def __init__(self, producer, settings: Settings):
        self.producer = producer
        self.settings = settings

    def publish(self, topic: str, key: str, event: dict, checkpoint=lambda: None):
        raw = json.dumps(event, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(raw) > MAX_EVENT_BYTES:
            raise DeliveryFailure()
        confirmation = []

        def delivered(error, _message):
            confirmation.append(error)

        try:
            checkpoint()
            self.producer.produce(topic=topic, key=key.encode("utf-8"), value=raw, on_delivery=delivered)
            deadline = time.monotonic() + self.settings.delivery_timeout_seconds
            while not confirmation:
                checkpoint()
                if time.monotonic() >= deadline:
                    raise DeliveryFailure()
                self.producer.poll(0.1)
            if confirmation[0] is not None:
                raise DeliveryFailure()
            checkpoint()
        except Exception as error:
            # Keep cancellation/security exceptions for the runner; sanitize Kafka failures.
            if isinstance(error, Cancelled):
                raise
            raise DeliveryFailure() from None

    def result(self, event: ModerationResultEvent, checkpoint=lambda: None):
        self.publish(self.settings.result_topic, event.aggregateId, event.model_dump(), checkpoint)

    def quarantine(self, message, reason: str, checkpoint=lambda: None):
        source = {"topic": message.topic(), "partition": message.partition(), "offset": message.offset()}
        source_id = f"{source['topic']}:{source['partition']}:{source['offset']}"
        # Never copy untrusted input, headers, exception text or target/user identities.
        event = {"type": "moderation.request.quarantined", "version": 1,
                 "eventId": str(uuid5(NAMESPACE_URL, "gachahub:quarantine:" + source_id)),
                 "source": source, "requestSha256": hashlib.sha256(message.value() or b"").hexdigest(),
                 "reason": reason}
        self.publish(self.settings.quarantine_topic, source_id, event, checkpoint)

    def close(self):
        # A shutdown flush is cleanup only; it never authorizes an offset commit.
        self.producer.flush(min(2, self.settings.delivery_timeout_seconds))
