"""A reusable local inference process with a real, parent-enforced deadline."""
import multiprocessing
from threading import Lock

from app.contracts.moderation import ClassifierOutput


def _serve(connection, factory, args):
    try:
        classifier = factory(*args)
        connection.send(("ready", None))
        while True:
            try:
                text = connection.recv()
            except EOFError:
                break
            if text is None:
                break
            try:
                output = ClassifierOutput.model_validate(classifier.classify(text))
                connection.send(("output", output.model_dump(mode="json")))
            except Exception:
                # Never transfer exceptions, model internals or input text to logs.
                connection.send(("failed", None))
    except Exception:
        try:
            connection.send(("failed", None))
        except (BrokenPipeError, EOFError, OSError):
            pass
    finally:
        connection.close()


class DeadlineClassifier:
    def __init__(self, factory, args, timeout_seconds=90, startup_timeout_seconds=120):
        self.factory = factory
        self.args = args
        self.timeout = timeout_seconds
        self.startup_timeout = startup_timeout_seconds
        self._context = multiprocessing.get_context("spawn")
        self._lock = Lock()
        self._process = None
        self._connection = None
        self._start()

    def _start(self):
        parent, child = self._context.Pipe()
        self._connection = parent
        self._process = self._context.Process(target=_serve, args=(child, self.factory, self.args), daemon=True)
        self._process.start()
        child.close()
        try:
            if not parent.poll(self.startup_timeout) or parent.recv()[0] != "ready":
                raise RuntimeError("Classifier startup failed")
        except (EOFError, OSError, RuntimeError):
            self.close()
            raise RuntimeError("Classifier startup failed") from None

    def classify(self, text):
        with self._lock:
            if self._process is None:
                self._start()
            try:
                self._connection.send(text)
                if not self._connection.poll(self.timeout):
                    self.close()
                    raise TimeoutError("Classifier deadline exceeded")
                kind, output = self._connection.recv()
                if kind != "output":
                    raise ValueError("Classifier could not evaluate the input")
                return ClassifierOutput.model_validate(output)
            except TimeoutError:
                raise
            except (EOFError, OSError):
                self.close()
                raise RuntimeError("Classifier process unavailable") from None

    def close(self):
        if self._connection is not None:
            self._connection.close()
            self._connection = None
        if self._process is not None:
            self._process.terminate()
            self._process.join(timeout=3)
            if self._process.is_alive():
                self._process.kill()
                self._process.join(timeout=3)
            self._process = None
