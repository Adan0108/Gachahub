import hashlib
import json
import re
import unicodedata
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

MAX_EVENT_BYTES = 32 * 1024
MAX_INPUT_BYTES = 256 * 1024
TEXT_INPUT_SCHEMA_VERSION = 1
MAX_CONTENT_CODEPOINTS = 30000
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,128}$")]
Fingerprint = Annotated[str, StringConstraints(pattern=r"^sha256:[a-f0-9]{64}$")]
Generation = Annotated[int, Field(ge=1, le=2147483647)]
# ECMAScript String.trim whitespace, deliberately not Python str.strip().
JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


class Contract(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, hide_input_in_errors=True)

    @field_validator("version", mode="before", check_fields=False)
    @classmethod
    def strict_version(cls, version):
        if type(version) is not int:
            raise ValueError("Version must be an integer")
        return version


def valid_timestamp(timestamp: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", timestamp):
        raise ValueError("Invalid timestamp")
    datetime.fromisoformat(timestamp)
    return timestamp


def normalize_text(text: str, limit: int) -> str:
    return unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n").strip(JS_WHITESPACE)[:limit]


def validate_text(text: str, limit: int) -> str:
    if len(text) > limit or "\0" in text or any(0xD800 <= ord(c) <= 0xDFFF for c in text):
        raise ValueError("Invalid bounded text")
    # Stage 2A trims BEFORE truncation, so a full prefix may end in whitespace.
    if normalize_text(text, limit) != text and not (len(text) == limit and normalize_text(text, limit) == text.rstrip(JS_WHITESPACE)):
        raise ValueError("Input must already be canonical")
    return text


class PostInput(Contract):
    type: Literal["POST"]
    title: str | None
    content: str

    @field_validator("title")
    @classmethod
    def title_bound(cls, title):
        if title is None:
            return None
        if title == "":
            raise ValueError("Empty title must be null")
        return validate_text(title, 300)

    @field_validator("content")
    @classmethod
    def content_bound(cls, content):
        return validate_text(content, MAX_CONTENT_CODEPOINTS)


class CommentInput(Contract):
    type: Literal["COMMENT"]
    content: str

    @field_validator("content")
    @classmethod
    def content_bound(cls, content):
        return validate_text(content, MAX_CONTENT_CODEPOINTS)


TextInput = Annotated[PostInput | CommentInput, Field(discriminator="type")]


def snapshot_hash(snapshot: PostInput | CommentInput) -> str:
    # JSON.stringify order and escaping, UTF-8, no LF. Hash stored text verbatim.
    content = {"type": snapshot.type}
    if isinstance(snapshot, PostInput):
        content["title"] = snapshot.title
    content["content"] = snapshot.content
    raw = json.dumps({"inputSchemaVersion": TEXT_INPUT_SCHEMA_VERSION, "input": content}, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


class AnalysisRequestedPayload(Contract):
    analysisJobId: Identifier
    caseId: Identifier
    targetType: Literal["POST", "COMMENT"]
    targetId: Identifier
    generation: Generation
    snapshotHash: Fingerprint
    inputSchemaVersion: Annotated[int, Field(ge=1, le=2147483647)]
    classifierProfile: Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")]


class AnalysisRequestedEvent(Contract):
    eventId: str
    type: Literal["moderation.analysis.requested"]
    version: Literal[1]
    occurredAt: str
    aggregateId: Identifier
    payload: AnalysisRequestedPayload

    _timestamp = field_validator("occurredAt")(valid_timestamp)

    @field_validator("eventId")
    @classmethod
    def uuid(cls, event_id):
        UUID(event_id)
        return event_id

    @model_validator(mode="after")
    def envelope(self):
        if type(self.version) is not int or self.aggregateId != self.payload.caseId:
            raise ValueError("Invalid envelope identity")
        return self


class ModerationInputResponse(AnalysisRequestedPayload):
    input: TextInput

class ModelIdentity(Contract):
    name: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    revision: Annotated[str, StringConstraints(min_length=1, max_length=256)]

    @field_validator("name", "revision")
    @classmethod
    def jsonb_text(cls, text):
        if text != text.strip(JS_WHITESPACE) or "\0" in text or any(0xD800 <= ord(c) <= 0xDFFF for c in text):
            raise ValueError("Invalid model identity")
        return text


class ModerationLabel(Contract):
    label: Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")]
    score: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class ClassifierOutput(Contract):
    model: ModelIdentity
    labels: Annotated[list[ModerationLabel], Field(min_length=1, max_length=32)]

    @model_validator(mode="after")
    def unique_labels(self):
        if len({label.label.lower() for label in self.labels}) != len(self.labels):
            raise ValueError("Duplicate labels")
        return self


class ResultIdentity(Contract):
    analysisJobId: Identifier
    caseId: Identifier
    generation: Generation
    snapshotHash: Fingerprint
    classifierProfile: Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")]
    completedAt: str
    _timestamp = field_validator("completedAt")(valid_timestamp)


class SuccessResult(ResultIdentity):
    status: Literal["SUCCEEDED"]
    output: ClassifierOutput


class FailedResult(ResultIdentity):
    status: Literal["FAILED"]
    errorCode: Annotated[str, StringConstraints(pattern=r"^[A-Z0-9_]{1,64}$")]


class ModerationResultEvent(Contract):
    eventId: str
    type: Literal["moderation.result"] = "moderation.result"
    version: Literal[1] = 1
    occurredAt: str
    aggregateId: Identifier
    payload: Annotated[SuccessResult | FailedResult, Field(discriminator="status")]
    _timestamp = field_validator("occurredAt")(valid_timestamp)

    @model_validator(mode="after")
    def envelope(self):
        UUID(self.eventId)
        if type(self.version) is not int or self.aggregateId != self.payload.caseId:
            raise ValueError("Invalid result identity")
        return self


def parse_request(raw: bytes | None) -> AnalysisRequestedEvent:
    if not raw or len(raw) > MAX_EVENT_BYTES:
        raise ValueError("Invalid event size")
    return AnalysisRequestedEvent.model_validate(json.loads(raw.decode("utf-8")))
