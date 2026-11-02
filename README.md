# GachaHub

A social platform for gacha-game communities: posts and guides per game, real-time community chat, end-to-end encrypted private messaging, AI-assisted moderation, and a reputation economy with profile cosmetics.

> **Status: archived.** This public repository is a snapshot kept as a portfolio project. Active development continued in a private repository.

## Highlights

- **End-to-end encrypted chat** using the MLS protocol (RFC 9420, via `ts-mls`): direct and group chats, multiple devices per user, encrypted history backup, reactions, replies, attachments, read receipts, typing and presence. The server only stores ciphertext.
- **Game communities** with posts (guides, builds, theories…), media uploads, likes, saves, comments, @mentions, and real-time community chat rooms.
- **Personalised feeds:** latest, trending, and "for you", ranked from each user's interests.
- **AI-assisted moderation pipeline:** reports become cases, a Python worker classifies the text with a multilingual toxicity model over Kafka, and moderators see an AI advisory before acting. Scoped enforcement (community or platform), temporary sanctions, appeals, and a full audit log.
- **Reputation economy:** likes and comments earn Reputation and Shards with anti-farming rules (hidden trust thresholds, per-giver daily limits, diminishing returns), ranks from Stargazer to Galaxy, and an append-only ledger with clawback when content is moderated.
- **Profiles and cosmetics:** public profiles, follow system, avatar frames, profile backgrounds, banners and a hover mini-profile card.
- **Realtime notifications** delivered through a transactional outbox → Kafka → WebSocket.
- **Admin and moderator dashboards** for users, communities, content, cases and cosmetics.

## Tech stack

| Area | Tech |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, TanStack Query, Vitest |
| Backend | NestJS 11, TypeScript, Prisma 7, PostgreSQL, Better Auth, Socket.IO, Jest |
| Messaging and cache | Kafka (transactional outbox), Redis (sessions, presence, rate limits, Socket.IO adapter) |
| Encryption | MLS via `ts-mls` (in the browser and on the server) |
| Moderation worker | Python, Hugging Face Transformers, PyTorch, confluent-kafka |
| Media | Cloudinary |

## Architecture

```mermaid
flowchart LR
  FE[Next.js frontend] -- REST + WebSocket --> BE[NestJS API]
  BE --> PG[(PostgreSQL)]
  BE --> R[(Redis)]
  BE -- outbox --> K[[Kafka]]
  K --> BE
  K <--> W[Python moderation worker]
  BE --> C[Cloudinary]
```

The backend writes domain events to an outbox table in the same transaction as the change; a dispatcher publishes them to Kafka. Notifications and moderation results are consumed back idempotently.

## Repository layout

```
backend/            NestJS API, Prisma schema and migrations, Docker services
frontend/           Next.js app
moderation-worker/  Python text-classification worker
```

## Running locally

**Requirements:** Node.js 22+, Docker, a PostgreSQL 17 database, and (optionally) Python 3.13 for the moderation worker.

### 1. Backend

```bash
cd backend
cp .env.example .env
npm ci
npm run docker:up
npx prisma migrate deploy
npm run start:dev
```

- In `.env`, set at least `DATABASE_URL`, `BETTER_AUTH_SECRET` (any long random string) and `NODE_ENV=development`.
- `docker:up` starts Redis, Kafka and a local PostgreSQL on port 5434 (`postgresql://postgres:postgres@localhost:5434/gachahub`), which you can use as `DATABASE_URL`.
- Media uploads need your own Cloudinary keys; everything else works without them.
- The API runs on http://localhost:3000, with Swagger docs at http://localhost:3000/docs.

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

Open http://localhost:5173. Set `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` in `.env.local`.

### 3. Moderation worker (optional)

Needed only for AI advisories on reports. See [`moderation-worker/README.md`](moderation-worker/README.md). Set the same `MODERATION_WORKER_TOKEN` in both `.env` files.

## Tests

```bash
cd backend && npm test
cd frontend && npm test
```

Backend database tests (`backend/test/*.e2e-spec.ts`) need a disposable local PostgreSQL. Never point them at a shared database.
