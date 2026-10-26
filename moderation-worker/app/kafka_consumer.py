import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event

from confluent_kafka import Consumer

from .config import Settings
from .errors import Cancelled, QuarantineRequired
from .kafka_producer import ConfirmedPublisher
from .processing import JobProcessor

logger = logging.getLogger("moderation_worker")


def log_event(event: str, message=None, level: int = logging.INFO) -> None:
    metadata = {"event": event, "level": logging.getLevelName(level),
                "timestamp": datetime.now(timezone.utc).isoformat()}
    if message is not None:
        metadata.update(partition=message.partition(), offset=message.offset())
    logger.log(level, json.dumps(metadata, separators=(",", ":")))


def create_consumer(settings: Settings):
    return Consumer({**settings.kafka_config(), "group.id": settings.kafka_group_id,
                     "enable.auto.commit": False, "enable.auto.offset.store": False,
                     "auto.offset.reset": "earliest", "partition.assignment.strategy": "range",
                     "max.poll.interval.ms": 300000, "fetch.message.max.bytes": 32768,
                     "queued.max.messages.kbytes": 1024, "log_level": 0})


class Worker:
    """One in-flight job per instance; consumer thread keeps polling during HTTP/inference.

    All assignments pause while processing. Rebalances cancel work; offsets are
    committed only for the original assignment epoch, after confirmed publication.
    """
    def __init__(self, consumer, publisher: ConfirmedPublisher, processor: JobProcessor, settings: Settings):
        self.consumer = consumer
        self.publisher = publisher
        self.processor = processor
        self.settings = settings
        self.stopping = Event()
        self.cancelled = Event()
        self.epoch = 0
        self.active = False

    def stop(self, *_args):
        self.stopping.set()
        self.cancelled.set()

    def _assigned(self, consumer, partitions):
        self.epoch += 1
        consumer.assign(partitions)
        if self.active:
            consumer.pause(partitions)

    def _revoked(self, _consumer, _partitions):
        self.epoch += 1
        self.cancelled.set()
        log_event("assignment_revoked")

    def _poll_checkpoint(self, epoch):
        if self.stopping.is_set() or self.cancelled.is_set() or self.epoch != epoch:
            raise Cancelled()
        # All partitions are paused. poll serves group callbacks during publish.
        unexpected = self.consumer.poll(0)
        if unexpected is not None:
            raise RuntimeError("Kafka checkpoint failed or received a record while paused")
        if self.stopping.is_set() or self.cancelled.is_set() or self.epoch != epoch:
            raise Cancelled()

    def handle_message(self, message, executor):
        self.active = True
        self.cancelled = Event()
        epoch = self.epoch
        self.consumer.pause(self.consumer.assignment())
        future = executor.submit(self.processor.process, message.value(), self.cancelled)
        try:
            while not future.done():
                self._poll_checkpoint(epoch)
                self.stopping.wait(0.05)
            self._poll_checkpoint(epoch)
            try:
                event = future.result()
            except QuarantineRequired as error:
                self.publisher.quarantine(message, error.reason, lambda: self._poll_checkpoint(epoch))
                log_event("request_quarantined_" + error.reason, message, level=logging.ERROR)
            else:
                self.publisher.result(event, lambda: self._poll_checkpoint(epoch))
            self._poll_checkpoint(epoch)
            committed = self.consumer.commit(message=message, asynchronous=False)
            if committed is None or any(partition.error for partition in committed):
                raise RuntimeError("Offset commit failed")
            log_event("request_committed", message)
        except Cancelled:
            log_event("request_cancelled_uncommitted", message)
        finally:
            self.cancelled.set()
            # Do not overlap old work with a new assignment. HTTP is time/size bounded.
            try:
                future.result()
            except Exception:
                pass
            self.active = False
            assignments = self.consumer.assignment()
            if assignments and not self.stopping.is_set():
                self.consumer.resume(assignments)

    def run(self):
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="moderation-job")
        try:
            self.consumer.subscribe([self.settings.request_topic], on_assign=self._assigned,
                                    on_revoke=self._revoked, on_lost=self._revoked)
            log_event("worker_started")
            while not self.stopping.is_set():
                message = self.consumer.poll(0.2)
                if message is None:
                    continue
                if message.error():
                    # Stop with fixed error; supervisor backoff is required, no tight loop.
                    raise RuntimeError("Kafka consumption failed")
                self.handle_message(message, executor)
        finally:
            self.stop()
            executor.shutdown(wait=True, cancel_futures=True)
            try:
                self.consumer.close()
            finally:
                self.publisher.close()
