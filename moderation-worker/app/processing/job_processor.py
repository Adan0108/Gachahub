from datetime import datetime, timezone
from threading import Event
from uuid import NAMESPACE_URL, uuid5

from app.infrastructure.http.backend_client import ModerationInputClient
from app.classifiers.base import Classifier
from app.contracts.moderation import (AnalysisRequestedPayload, ClassifierOutput, FailedResult, ModerationInputResponse,
                        ModerationResultEvent, PostInput, SuccessResult, TEXT_INPUT_SCHEMA_VERSION, parse_request, snapshot_hash)
from app.core.errors import Cancelled, QuarantineRequired
from app.classifiers.model_profile import FIXTURE_PROFILE, HUGGINGFACE_PROFILE


def verify_identity(request: AnalysisRequestedPayload, resolved: ModerationInputResponse):
    if request.inputSchemaVersion != TEXT_INPUT_SCHEMA_VERSION or request.classifierProfile not in {FIXTURE_PROFILE, HUGGINGFACE_PROFILE}:
        raise QuarantineRequired("UNSUPPORTED_INPUT")
    for field in AnalysisRequestedPayload.model_fields:
        if getattr(request, field) != getattr(resolved, field):
            raise QuarantineRequired("INPUT_IDENTITY")
    if resolved.input.type != request.targetType or snapshot_hash(resolved.input) != request.snapshotHash:
        raise QuarantineRequired("INPUT_INTEGRITY")


class JobProcessor:
    def __init__(self, backend: ModerationInputClient, classifier: Classifier, classifier_profile: str = FIXTURE_PROFILE):
        self.backend = backend
        self.classifier = classifier
        self.classifier_profile = classifier_profile

    def process(self, raw: bytes | None, cancelled: Event) -> ModerationResultEvent:
        try:
            event = parse_request(raw)
        except (ValueError, UnicodeError):
            raise QuarantineRequired("REQUEST_CONTRACT") from None
        request = event.payload
        if request.inputSchemaVersion != TEXT_INPUT_SCHEMA_VERSION or request.classifierProfile != self.classifier_profile:
            raise QuarantineRequired("UNSUPPORTED_INPUT")
        resolved = self.backend.get_analysis_input(request.analysisJobId, cancelled)
        verify_identity(request, resolved)
        if cancelled.is_set():
            raise Cancelled()
        text = resolved.input.content
        if isinstance(resolved.input, PostInput) and resolved.input.title:
            text = resolved.input.title + "\n\n" + text
        identity = {field: getattr(request, field) for field in
                    ["analysisJobId", "caseId", "generation", "snapshotHash", "classifierProfile"]}
        try:
            cancellable = getattr(type(self.classifier), 'classify_cancellable', None)
            result = (cancellable(self.classifier, text, cancelled) if callable(cancellable)
                      else self.classifier.classify(text))
            output = ClassifierOutput.model_validate(result)
            failure = False
            failure_code = "CLASSIFIER_ERROR"
        except Cancelled:
            raise
        except TimeoutError:
            failure = True
            failure_code = "CLASSIFIER_TIMEOUT"
        except Exception:
            # Stage 2B allows bounded uppercase machine codes, not a closed enum.
            failure = True
            failure_code = "CLASSIFIER_ERROR"
        if cancelled.is_set():
            raise Cancelled()
        completed = datetime.now(timezone.utc).isoformat()
        payload = (FailedResult(**identity, status="FAILED", errorCode=failure_code, completedAt=completed)
                   if failure else SuccessResult(**identity, status="SUCCEEDED", output=output, completedAt=completed))
        event_id = uuid5(NAMESPACE_URL, "gachahub:moderation.result:" + request.analysisJobId + ":" +
                         request.snapshotHash + ":" + request.classifierProfile)
        return ModerationResultEvent(eventId=str(event_id), occurredAt=completed, aggregateId=request.caseId, payload=payload)
