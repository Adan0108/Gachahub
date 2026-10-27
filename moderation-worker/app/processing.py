from datetime import datetime, timezone
from threading import Event
from uuid import NAMESPACE_URL, uuid5

from .backend_client import ModerationInputClient
from .classifier import Classifier
from .contracts import (AnalysisRequestedPayload, ClassifierOutput, FailedResult, ModerationInputResponse,
                        ModerationResultEvent, PostInput, SuccessResult, parse_request, snapshot_hash)
from .errors import Cancelled, QuarantineRequired
from .model_profile import FIXTURE_PROFILE, HUGGINGFACE_PROFILE


def verify_identity(request: AnalysisRequestedPayload, resolved: ModerationInputResponse):
    if request.inputSchemaVersion != 1 or request.classifierProfile not in {FIXTURE_PROFILE, HUGGINGFACE_PROFILE}:
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
        if request.inputSchemaVersion != 1 or request.classifierProfile != self.classifier_profile:
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
            output = ClassifierOutput.model_validate(self.classifier.classify(text))
            failure = False
        except Exception:
            # Stage 2B allows bounded uppercase machine codes, not a closed enum.
            failure = True
        if cancelled.is_set():
            raise Cancelled()
        completed = datetime.now(timezone.utc).isoformat()
        payload = (FailedResult(**identity, status="FAILED", errorCode="CLASSIFIER_ERROR", completedAt=completed)
                   if failure else SuccessResult(**identity, status="SUCCEEDED", output=output, completedAt=completed))
        event_id = uuid5(NAMESPACE_URL, "gachahub:moderation.result:" + request.analysisJobId + ":" +
                         request.snapshotHash + ":" + request.classifierProfile)
        return ModerationResultEvent(eventId=str(event_id), occurredAt=completed, aggregateId=request.caseId, payload=payload)
