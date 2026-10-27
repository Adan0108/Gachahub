import os
import re
from typing import Literal
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from .model_profile import FIXTURE_PROFILE, HUGGINGFACE_PROFILE, MODEL_MAX_LENGTH, MODEL_NAME, MODEL_REVISION


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    environment: Literal["local", "production"] = "production"
    classifier_backend: Literal["fixture", "huggingface"] = "fixture"
    classifier_model_name: str = MODEL_NAME
    classifier_model_revision: str = MODEL_REVISION
    classifier_max_length: int = MODEL_MAX_LENGTH
    backend_base_url: str
    moderation_worker_token: SecretStr
    kafka_brokers: str = Field(min_length=1)
    kafka_group_id: str = Field(default="gachahub-moderation-worker", min_length=1, max_length=255)
    request_topic: str = "gachahub.moderation.requests"
    result_topic: str = "gachahub.moderation.results"
    quarantine_topic: str = "gachahub.moderation.requests.quarantine"
    http_timeout_seconds: float = Field(default=10, gt=0, le=30)
    http_attempts: int = Field(default=3, ge=1, le=5)
    retry_base_seconds: float = Field(default=0.5, gt=0, le=5)
    delivery_timeout_seconds: float = Field(default=15, ge=1, le=60)
    kafka_security_protocol: Literal["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"] = "SSL"
    kafka_sasl_mechanism: Literal["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"] = "SCRAM-SHA-512"
    kafka_sasl_username: str | None = None
    kafka_sasl_password: SecretStr | None = None
    kafka_ssl_ca_location: str | None = None
    kafka_ssl_certificate_location: str | None = None
    kafka_ssl_key_location: str | None = None
    kafka_ssl_key_password: SecretStr | None = None

    @model_validator(mode="after")
    def validate_security(self):
        if (self.classifier_model_name, self.classifier_model_revision, self.classifier_max_length) != (
                MODEL_NAME, MODEL_REVISION, MODEL_MAX_LENGTH):
            raise ValueError("Classifier settings must match the immutable model profile")
        url = urlsplit(self.backend_base_url)
        if (url.scheme not in {"http", "https"} or not url.hostname or url.username or
                url.password or url.query or url.fragment or url.path not in {"", "/"}):
            raise ValueError("Backend URL must be an HTTP(S) origin without credentials")
        if url.scheme == "http" and not (self.environment == "local" and url.hostname in {"localhost", "127.0.0.1", "::1", "host.docker.internal"}):
            raise ValueError("Backend URL requires HTTPS outside local loopback")
        token = self.moderation_worker_token.get_secret_value()
        if not 32 <= len(token) <= 512 or any(not 33 <= ord(c) <= 126 for c in token):
            raise ValueError("Worker token requires 32-512 printable ASCII characters")
        if self.environment != "local" and self.kafka_security_protocol not in {"SSL", "SASL_SSL"}:
            raise ValueError("Kafka requires TLS outside local development")
        if self.kafka_security_protocol.startswith("SASL") and not (self.kafka_sasl_username and self.kafka_sasl_password):
            raise ValueError("Kafka SASL credentials are required")
        topics = [self.request_topic, self.result_topic, self.quarantine_topic]
        if len(set(topics)) != 3 or any(not re.fullmatch(r"[A-Za-z0-9._-]{1,249}", topic) or topic in {".", ".."} for topic in topics):
            raise ValueError("Kafka topics must be distinct valid topic names")
        return self

    @property
    def classifier_profile(self) -> str:
        return HUGGINGFACE_PROFILE if self.classifier_backend == "huggingface" else FIXTURE_PROFILE

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        names = {"environment": "WORKER_ENV", "request_topic": "KAFKA_MODERATION_REQUEST_TOPIC",
                 "result_topic": "KAFKA_MODERATION_RESULT_TOPIC", "quarantine_topic": "KAFKA_MODERATION_QUARANTINE_TOPIC",
                 "kafka_group_id": "KAFKA_MODERATION_WORKER_GROUP_ID"}
        return cls.model_validate({field: os.environ[names.get(field, field.upper())]
                                   for field in cls.model_fields if names.get(field, field.upper()) in os.environ})

    def kafka_config(self) -> dict:
        config = {"bootstrap.servers": self.kafka_brokers, "security.protocol": self.kafka_security_protocol,
                  "allow.auto.create.topics": False}
        for field, option in {"kafka_sasl_username": "sasl.username", "kafka_sasl_password": "sasl.password",
                              "kafka_ssl_ca_location": "ssl.ca.location", "kafka_ssl_certificate_location": "ssl.certificate.location",
                              "kafka_ssl_key_location": "ssl.key.location", "kafka_ssl_key_password": "ssl.key.password"}.items():
            value = getattr(self, field)
            if value is not None:
                config[option] = value.get_secret_value() if isinstance(value, SecretStr) else value
        if self.kafka_security_protocol.startswith("SASL"):
            config["sasl.mechanism"] = self.kafka_sasl_mechanism
        return config
