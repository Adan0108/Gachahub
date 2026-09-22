# Things that break with more than one backend instance

Every one of these lives in one process's memory. Running two or more backend
instances does not crash - it quietly weakens them. Before scaling out, move
each to a shared store (Redis) or a leader-elected job.

| What | Where | Failure with 2+ instances |
| --- | --- | --- |
| Login cache | `src/auth/session-storage.ts` | a revoke only takes effect on the instance that handled it; the others serve the deleted login until its TTL |
| Key-package fetch rate limit | `src/chat-devices/key-package-fetch-rate-limiter.service.ts` | limits multiply by the instance count |
| Key-package upload rate limit | `src/chat-devices/key-package-upload-rate-limiter.service.ts` | same |
| Chat message rate limit | `src/chat/chat-message-rate-limiter.service.ts` | same |
| Self-join rate limit | `src/mls-handshakes/mls-self-join-rate-limiter.service.ts` | same |
| Socket delivery / session sign-out | `src/websocket/socket-registry.service.ts` | an instance can only sign out sockets connected to itself |
| Cron jobs | `mls-key-package-cleanup`, the integrity sweep (`common/integrity`), media cleanup | run once per instance: duplicate work and duplicate Discord alerts |

There is no startup guard for this today - nothing reliable exists to count
instances from inside one. Revisit when deployment grows past one instance.
