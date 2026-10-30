import json
import random
import time
from threading import Event

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.contracts.moderation import MAX_INPUT_BYTES, ModerationInputResponse
from app.core.errors import Cancelled, QuarantineRequired, SecurityFailure


class ModerationInputClient:
    def __init__(self, settings: Settings, client: httpx.Client | None = None, jitter=random.random):
        self.settings = settings
        self.jitter = jitter
        self.client = client or httpx.Client(
            base_url=settings.backend_base_url, timeout=settings.http_timeout_seconds,
            follow_redirects=False, trust_env=False,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
            headers={"Authorization": "Bearer " + settings.moderation_worker_token.get_secret_value(),
                     "User-Agent": "gachahub-moderation-worker/1", "Accept-Encoding": "identity"},
        )

    def get_analysis_input(self, analysis_job_id: str, cancelled: Event) -> ModerationInputResponse:
        for attempt in range(self.settings.http_attempts):
            if cancelled.is_set():
                raise Cancelled()
            try:
                deadline = time.monotonic() + self.settings.http_timeout_seconds
                with self.client.stream("GET", f"/internal/moderation/analyses/{analysis_job_id}/input") as response:
                    status = response.status_code
                    if status in {401, 403}:
                        raise SecurityFailure()
                    if status in {404, 410}:
                        raise QuarantineRequired("INPUT_NOT_FOUND")
                    if status == 429 or status >= 500:
                        raise httpx.HTTPStatusError("Retryable backend response", request=response.request, response=response)
                    if status != 200:
                        raise QuarantineRequired("HTTP_PERMANENT")
                    if response.headers.get("content-encoding", "identity") != "identity":
                        raise QuarantineRequired("INPUT_ENCODING")
                    raw = bytearray()
                    for chunk in response.iter_bytes():
                        if cancelled.is_set():
                            raise Cancelled()
                        if time.monotonic() > deadline:
                            raise httpx.ReadTimeout("Input deadline exceeded")
                        raw.extend(chunk)
                        if len(raw) > MAX_INPUT_BYTES:
                            raise QuarantineRequired("INPUT_TOO_LARGE")
                return ModerationInputResponse.model_validate(json.loads(raw.decode("utf-8")))
            except (ValidationError, ValueError, UnicodeError):
                raise QuarantineRequired("INPUT_CONTRACT") from None
            except (httpx.TransportError, httpx.HTTPStatusError):
                if attempt + 1 == self.settings.http_attempts:
                    raise QuarantineRequired("HTTP_RETRIES_EXHAUSTED") from None
                delay = min(10, self.settings.retry_base_seconds * 2 ** attempt) * (0.5 + self.jitter())
                if cancelled.wait(delay):
                    raise Cancelled()
        raise AssertionError("Unreachable")

    def close(self):
        self.client.close()
