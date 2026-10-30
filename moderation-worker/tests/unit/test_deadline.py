import time
import unittest
import json
from threading import Event, Timer
from unittest.mock import Mock

from app.classifiers.deadline import DeadlineClassifier
from app.classifiers.fixture import FixtureClassifier
from app.contracts.moderation import ModerationInputResponse
from app.processing.job_processor import JobProcessor
from tests.unit.test_worker import request, resolved
from app.core.errors import Cancelled
from concurrent.futures import ThreadPoolExecutor
from tests.unit import test_worker as worker_fixtures


class SlowFixture:
    def classify(self, text):
        if text == "slow":
            time.sleep(30)
        return FixtureClassifier().classify(text)


class SlowAllFixture:
    def classify(self, text):
        time.sleep(30)
        return FixtureClassifier().classify(text)


class DeadlineTests(unittest.TestCase):
    def test_worker_rebalance_cancels_real_job_processor_and_never_publishes_or_commits(self):
        backend = Mock()
        backend.get_analysis_input.return_value = ModerationInputResponse.model_validate(resolved())
        classifier = DeadlineClassifier(SlowAllFixture, (), timeout_seconds=90, startup_timeout_seconds=10)
        worker, consumer, producer, _ = worker_fixtures.KafkaTests().worker(JobProcessor(backend, classifier))
        started = time.monotonic()
        def poll(_timeout):
            if time.monotonic() - started >= 0.15:
                worker._revoked(consumer, [])
            return None
        consumer.poll.side_effect = poll
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                worker.handle_message(worker_fixtures.FakeMessage(), executor)
            self.assertLess(time.monotonic() - started, 8)
            consumer.commit.assert_not_called()
            self.assertEqual(producer.values, [])
            self.assertIsNone(classifier._process)
        finally:
            classifier.close()
    def test_rebalance_cancels_native_inference_without_waiting_for_deadline(self):
        classifier = DeadlineClassifier(SlowFixture, (), timeout_seconds=90, startup_timeout_seconds=10)
        cancelled = Event()
        timer = Timer(0.1, cancelled.set)
        timer.start()
        try:
            started = time.monotonic()
            with self.assertRaises(Cancelled):
                classifier.classify_cancellable('slow', cancelled)
            self.assertLess(time.monotonic()-started, 8)
            self.assertIsNone(classifier._process)
        finally:
            timer.cancel()
            classifier.close()
    def test_timeout_publishes_an_explicit_failed_generation(self):
        backend = Mock()
        backend.get_analysis_input.return_value = ModerationInputResponse.model_validate(resolved())
        classifier = Mock()
        classifier.classify.side_effect = TimeoutError()
        result = JobProcessor(backend, classifier).process(json.dumps(request()).encode(), Event())
        self.assertEqual(result.payload.status, "FAILED")
        self.assertEqual(result.payload.errorCode, "CLASSIFIER_TIMEOUT")
    def test_deadline_terminates_the_native_inference_process_and_next_job_recovers(self):
        classifier = DeadlineClassifier(SlowFixture, (), timeout_seconds=0.1, startup_timeout_seconds=10)
        try:
            started = time.monotonic()
            with self.assertRaises(TimeoutError):
                classifier.classify("slow")
            self.assertLess(time.monotonic() - started, 8)
            self.assertIsNone(classifier._process)
            classifier.timeout = 2
            self.assertEqual(classifier.classify("fixture-toxic").labels[0].score, 0.9)
        finally:
            classifier.close()

    def test_process_is_reused_for_successful_jobs(self):
        classifier = DeadlineClassifier(SlowFixture, (), startup_timeout_seconds=10)
        try:
            process = classifier._process
            classifier.classify("one")
            classifier.classify("two")
            self.assertIs(classifier._process, process)
        finally:
            classifier.close()


if __name__ == "__main__":
    unittest.main()
