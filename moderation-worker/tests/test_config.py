import unittest

from pydantic import ValidationError

from app.config import Settings


class BackendURLSecurityTests(unittest.TestCase):
    def settings(self, url, environment="local"):
        return Settings(environment=environment, backend_base_url=url,
                        moderation_worker_token="synthetic-test-" + "a" * 32,
                        kafka_brokers="localhost:9092", kafka_security_protocol="SSL")

    def test_local_loopback_and_exact_docker_host_http_accepted(self):
        for host in ("localhost", "127.0.0.1", "[::1]", "host.docker.internal"):
            with self.subTest(host):
                self.settings(f"http://{host}:3000")

    def test_production_http_rejected_including_docker_host(self):
        for host in ("localhost", "127.0.0.1", "host.docker.internal", "private.example"):
            with self.subTest(host), self.assertRaises(ValidationError):
                self.settings(f"http://{host}:3000", "production")

    def test_arbitrary_local_http_still_rejected(self):
        for host in ("private.example", "192.168.1.2", "host.docker.internal.example", "kafka"):
            with self.subTest(host), self.assertRaises(ValidationError):
                self.settings(f"http://{host}:3000")

    def test_https_unchanged_for_local_and_production(self):
        for environment in ("local", "production"):
            for host in ("private.example", "host.docker.internal", "localhost"):
                with self.subTest(environment=environment, host=host):
                    self.settings(f"https://{host}:3000", environment)


if __name__ == "__main__":
    unittest.main()
