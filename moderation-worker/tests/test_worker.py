import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from unittest.mock import Mock

import httpx
from pydantic import ValidationError

from app.backend_client import ModerationInputClient
from app.classifier import FixtureClassifier
from app.config import Settings
from app.contracts import (AnalysisRequestedEvent, CommentInput, ModerationInputResponse, PostInput,
                           MAX_INPUT_BYTES, normalize_text, parse_request, snapshot_hash)
from app.errors import Cancelled, DeliveryFailure, QuarantineRequired, SecurityFailure
from app.kafka_consumer import Worker
from app.kafka_producer import ConfirmedPublisher
from app.processing import JobProcessor, verify_identity


def settings(**changes):
    return Settings(environment="local", backend_base_url="http://localhost:3000",
                    moderation_worker_token="test-only-" + "a"*32, kafka_brokers="localhost:9092",
                    kafka_security_protocol="PLAINTEXT", **changes)


def request():
    snapshot = PostInput(type="POST", title="title", content="fixture-toxic")
    return {"eventId": "11111111-1111-4111-8111-111111111111", "type": "moderation.analysis.requested",
            "version": 1, "occurredAt": "2026-10-26T00:00:00Z", "aggregateId": "case",
            "payload": {"analysisJobId": "job", "caseId": "case", "generation": 1,
                        "targetType": "POST", "targetId": "post", "snapshotHash": snapshot_hash(snapshot),
                        "inputSchemaVersion": 1, "classifierProfile": "moderation-text-v1"}}


def resolved():
    return {**request()["payload"], "input": {"type": "POST", "title": "title", "content": "fixture-toxic"}}


def processor(classifier=None):
    backend = Mock()
    backend.get_analysis_input.return_value = ModerationInputResponse.model_validate(resolved())
    return JobProcessor(backend, classifier or FixtureClassifier())


class ContractsTests(unittest.TestCase):
    def test_shared_hash_vectors(self):
        vectors = json.loads((Path(__file__).parent / "fixtures/canonical-text-v1.json").read_text(encoding="utf-8"))
        for vector in vectors:
            with self.subTest(vector["name"]):
                source = vector["source"]
                input_data = {"type": source["type"], "content": normalize_text(source["content"], 20000)}
                if source["type"] == "POST":
                    input_data["title"] = normalize_text(source["title"] or "", 300) or None
                self.assertEqual(input_data, vector["input"])
                parsed = PostInput.model_validate(input_data) if source["type"] == "POST" else CommentInput.model_validate(input_data)
                self.assertEqual(snapshot_hash(parsed), vector["snapshotHash"])
                self.assertEqual(json.dumps({"inputSchemaVersion": 1, "input": {k: input_data[k] for k in (["type", "title", "content"] if source["type"] == "POST" else ["type", "content"])}}, ensure_ascii=False, separators=(",", ":")), vector["serialized"])

    def test_request_rejects_invalid_types_bounds_fields_envelope(self):
        mutations = [("generation", True), ("generation", "1"), ("generation", 0), ("generation", 2147483648),
                     ("snapshotHash", "bad"), ("analysisJobId", "../job"), ("targetId", "x\0"),
                     ("inputSchemaVersion", True), ("private", "extra")]
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                event = request()
                event["payload"][field] = value
                with self.assertRaises(ValidationError):
                    AnalysisRequestedEvent.model_validate(event)
        for changes in [{"aggregateId": "other"}, {"version": True}, {"eventId": "bad"},
                        {"occurredAt": "yesterday"}, {"extra": "field"}]:
            with self.assertRaises(ValidationError):
                AnalysisRequestedEvent.model_validate({**request(), **changes})
        for raw in [None, b"", b"{", b"\xff", b" " * 32769, json.dumps(request()).encode("utf-16")]:
            with self.assertRaises((ValueError, UnicodeError)):
                parse_request(raw)

    def test_identity_and_content_hash_checked_independently(self):
        payload = AnalysisRequestedEvent.model_validate(request()).payload
        for field in type(payload).model_fields:
            data = resolved()
            if field in {"generation", "inputSchemaVersion"}:
                data[field] += 1
            elif field == "targetType":
                data[field] = "COMMENT"
            elif field == "snapshotHash":
                data[field] = "sha256:" + "a"*64
            else:
                data[field] += "other"
            with self.subTest(field), self.assertRaises(QuarantineRequired):
                verify_identity(payload, ModerationInputResponse.model_validate(data))
        tampered = resolved()
        tampered["input"]["content"] = "tampered but same advertised hash"
        with self.assertRaises(QuarantineRequired):
            verify_identity(payload, ModerationInputResponse.model_validate(tampered))

    def test_snapshot_bounds_unicode_and_prefix(self):
        PostInput(type="POST", title="a"*299+" ", content="\U0001f600"*20000)
        for content in ["x"*20001, "bad\0text", "bad\ud800", " noncanonical", "cafe\u0301"]:
            with self.assertRaises(ValidationError):
                CommentInput(type="COMMENT", content=content)

    def test_determinism_and_failed_contract(self):
        raw = json.dumps(request()).encode()
        first = processor().process(raw, Event())
        second = processor().process(raw, Event())
        self.assertEqual(first.eventId, second.eventId)
        self.assertEqual(first.payload.output, second.payload.output)
        self.assertEqual(first.payload.output.labels[0].score, 0.9)
        broken = Mock()
        broken.classify.side_effect = RuntimeError("private text")
        failed = processor(broken).process(raw, Event())
        self.assertEqual(failed.payload.errorCode, "CLASSIFIER_ERROR")
        self.assertNotIn("private", failed.model_dump_json())
        self.assertNotIn("output", failed.payload.model_dump())

    def test_unsupported_profile_never_calls_backend(self):
        event = request()
        event["payload"]["classifierProfile"] = "future-profile"
        proc = processor()
        with self.assertRaises(QuarantineRequired):
            proc.process(json.dumps(event).encode(), Event())
        proc.backend.get_analysis_input.assert_not_called()


class HTTPTests(unittest.TestCase):
    def client(self, handler, **changes):
        return ModerationInputClient(settings(**changes), httpx.Client(base_url="http://localhost", transport=httpx.MockTransport(handler)))

    def test_success_and_transient_retry(self):
        statuses = iter([503, 429, 200])
        calls = []
        def handler(req):
            calls.append(req)
            return httpx.Response(next(statuses), json=resolved())
        client = self.client(handler, retry_base_seconds=0.001)
        try:
            self.assertEqual(client.get_analysis_input("job", Event()).analysisJobId, "job")
            self.assertEqual(len(calls), 3)
        finally:
            client.close()

    def test_status_classification(self):
        for status, error in [(401, SecurityFailure), (403, SecurityFailure), (404, QuarantineRequired),
                              (410, QuarantineRequired), (302, QuarantineRequired), (400, QuarantineRequired), (500, QuarantineRequired)]:
            with self.subTest(status):
                calls = []
                def handler(req):
                    calls.append(req)
                    return httpx.Response(status, json={})
                client = self.client(handler, http_attempts=2, retry_base_seconds=0.001)
                try:
                    with self.assertRaises(error):
                        client.get_analysis_input("job", Event())
                    self.assertEqual(len(calls), 2 if status == 500 else 1)
                finally:
                    client.close()

    def test_transport_timeouts_contract_and_size(self):
        handlers = [lambda req: (_ for _ in ()).throw(httpx.ReadTimeout("secret")),
                    lambda req: httpx.Response(200, content=b"private invalid JSON"),
                    lambda req: httpx.Response(200, json={}),
                    lambda req: httpx.Response(200, content=b"x"*(MAX_INPUT_BYTES+1))]
        for handler in handlers:
            client = self.client(handler, http_attempts=1)
            try:
                with self.assertRaises(QuarantineRequired):
                    client.get_analysis_input("job", Event())
            finally:
                client.close()

    def test_retry_backoff_and_shutdown(self):
        client = self.client(lambda req: httpx.Response(503), retry_base_seconds=1)
        client.jitter = lambda: 0.5
        cancelled = Mock()
        cancelled.is_set.return_value = False
        cancelled.wait.side_effect = [False, False]
        with self.assertRaises(QuarantineRequired):
            client.get_analysis_input("job", cancelled)
        self.assertEqual([call.args[0] for call in cancelled.wait.call_args_list], [1, 2])
        cancelled.wait.side_effect = [True]
        with self.assertRaises(Cancelled):
            client.get_analysis_input("job", cancelled)
        client.close()

    def test_configuration_fails_closed_and_secrets_hidden(self):
        for changes in [{"backend_base_url": "http://private.example"}, {"backend_base_url": "https://user:password@example.com"},
                        {"moderation_worker_token": "short"}, {"environment": "production"},
                        {"result_topic": "gachahub.moderation.requests"}, {"kafka_security_protocol": "SASL_SSL"}]:
            data = settings().model_dump()
            data.update(changes)
            with self.subTest(changes), self.assertRaises(ValidationError):
                Settings.model_validate(data)
        self.assertNotIn("a"*32, repr(settings()))


class FakeProducer:
    def __init__(self, mode="success", order=None):
        self.mode = mode
        self.order = order if order is not None else []
        self.values = []
    def produce(self, **kwargs):
        if self.mode == "queue":
            raise BufferError("full")
        self.callback = kwargs["on_delivery"]
        self.values.append(json.loads(kwargs["value"]))
        self.order.append("produce")
    def poll(self, _timeout):
        if self.mode != "timeout":
            self.callback(None if self.mode == "success" else "failed", None)
            self.order.append("ack")
    def flush(self, _timeout):
        return 0


class FakeMessage:
    def value(self): return json.dumps(request()).encode()
    def topic(self): return "gachahub.moderation.requests"
    def partition(self): return 0
    def offset(self): return 42
    def error(self): return None


class KafkaTests(unittest.TestCase):
    def test_only_positive_delivery_callback_confirms_publication(self):
        from unittest.mock import patch
        for mode in ["success", "queue", "error", "timeout"]:
            producer = FakeProducer(mode)
            publisher = ConfirmedPublisher(producer, settings())
            with self.subTest(mode):
                if mode == "success":
                    publisher.result(processor().process(FakeMessage().value(), Event()))
                else:
                    with patch("app.kafka_producer.time.monotonic", side_effect=[0, 0, 999]):
                        with self.assertRaises(DeliveryFailure):
                            publisher.result(processor().process(FakeMessage().value(), Event()))

    def worker(self, proc=None, mode="success"):
        order = []
        consumer = Mock()
        consumer.assignment.return_value = [Mock()]
        consumer.poll.return_value = None
        committed = Mock()
        committed.error = None
        consumer.commit.side_effect = lambda **kwargs: (order.append("commit") or [committed])
        producer = FakeProducer(mode, order)
        worker = Worker(consumer, ConfirmedPublisher(producer, settings()), proc or processor(), settings())
        return worker, consumer, producer, order

    def test_publish_ack_precedes_commit_duplicate_delivery_safe(self):
        worker, consumer, producer, order = self.worker()
        with ThreadPoolExecutor(max_workers=1) as executor:
            worker.handle_message(FakeMessage(), executor)
            worker.handle_message(FakeMessage(), executor)
        self.assertEqual(order, ["produce", "ack", "commit"]*2)
        self.assertEqual(producer.values[0]["eventId"], producer.values[1]["eventId"])
        consumer.commit.assert_called_with(message=unittest.mock.ANY, asynchronous=False)

    def test_publish_failure_prevents_commit_and_stops_before_next_record(self):
        worker, consumer, producer, order = self.worker(mode="error")
        with ThreadPoolExecutor(max_workers=1) as executor, self.assertRaises(DeliveryFailure):
            worker.handle_message(FakeMessage(), executor)
        consumer.commit.assert_not_called()
        self.assertEqual(order, ["produce", "ack"])

    def test_poison_quarantine_ack_before_commit_no_payload(self):
        proc = Mock()
        proc.process.side_effect = QuarantineRequired("REQUEST_CONTRACT")
        worker, consumer, producer, order = self.worker(proc)
        with ThreadPoolExecutor(max_workers=1) as executor:
            worker.handle_message(FakeMessage(), executor)
        self.assertEqual(order, ["produce", "ack", "commit"])
        self.assertEqual(set(producer.values[0]), {"type", "version", "eventId", "source", "requestSha256", "reason"})
        self.assertNotIn("fixture-toxic", json.dumps(producer.values))
        worker, consumer, _, _ = self.worker(proc, mode="error")
        with ThreadPoolExecutor(max_workers=1) as executor, self.assertRaises(DeliveryFailure):
            worker.handle_message(FakeMessage(), executor)
        consumer.commit.assert_not_called()

    def test_security_failure_no_commit(self):
        proc = Mock()
        proc.process.side_effect = SecurityFailure()
        worker, consumer, _, _ = self.worker(proc)
        with ThreadPoolExecutor(max_workers=1) as executor, self.assertRaises(SecurityFailure):
            worker.handle_message(FakeMessage(), executor)
        consumer.commit.assert_not_called()

    def test_rebalance_and_shutdown_cancel_no_commit(self):
        for stop in ["rebalance", "shutdown"]:
            proc = Mock()
            worker, consumer, producer, _ = self.worker(proc)
            started = Event()
            def process(_raw, cancelled):
                started.set()
                if not cancelled.wait(2):
                    raise AssertionError("Cancellation not signalled")
                raise Cancelled()
            proc.process.side_effect = process
            def poll(_timeout):
                started.wait(1)
                if stop == "rebalance":
                    worker._revoked(consumer, [])
                else:
                    worker.stop()
                return None
            consumer.poll.side_effect = poll
            with ThreadPoolExecutor(max_workers=1) as executor:
                worker.handle_message(FakeMessage(), executor)
            consumer.commit.assert_not_called()
            self.assertEqual(producer.values, [])

    def test_rebalance_after_delivery_before_commit(self):
        worker, consumer, producer, _ = self.worker()
        original_poll = producer.poll
        def poll(timeout):
            original_poll(timeout)
            worker._revoked(consumer, [])
        producer.poll = poll
        with ThreadPoolExecutor(max_workers=1) as executor:
            worker.handle_message(FakeMessage(), executor)
        consumer.commit.assert_not_called()
        self.assertEqual(len(producer.values), 1)

    def test_graceful_cleanup(self):
        worker, consumer, producer, _ = self.worker()
        consumer.poll.side_effect = lambda timeout: worker.stop()
        worker.run()
        consumer.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
