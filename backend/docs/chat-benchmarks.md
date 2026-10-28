# Chat benchmarks

Measured for #105 on 22 October 2026, before deciding what to change. Re-run after changing any
of these paths, and update the table.

## How to run

```bash
npm run docker:up
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/gachahub npx prisma migrate deploy
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/gachahub npx tsx scripts/chat-benchmark.ts
```

`scripts/chat-benchmark.ts` refuses any database that is not on localhost: it seeds about 700,000
rows. It seeds once (it skips seeding when `bench-0` exists); `npm run docker:reset` starts over.

## Data

- 2,000 users, 5,440 conversations, 216,000 messages, 504,000 receipts (one per recipient per
  message, as every send writes).
- The measured user has a heavy inbox: 440 conversations, 400 direct chats and 40 groups of 50, 150
  messages each, the last few unread.
- Local Postgres 17 in Docker on a laptop, 30 runs of each query, measured through the real
  repository methods (Prisma included).

## Results

| Query | p50 | p95 |
| --- | --- | --- |
| Inbox, all 440 conversations | 170 ms | 220 ms |
| Inbox, first page of 50 | 55 ms | 59 ms |
| Unread counts for 440 chats | 8.5 ms | 9.8 ms |
| Unread messages, total | 16.5 ms | 17.2 ms |
| Unread chats, total | 71 ms | 75 ms |
| History, newest 50 | 11.5 ms | 18.6 ms |
| History, the 50 before those | 12.5 ms | 24.9 ms |

Outbox dispatcher, Kafka stubbed so only the database work counts: 2,000 events drained in 6.9 s,
about 290 events a second. Before #105 it took at most 20 events every 2 s, so the same backlog
needed 100 ticks, over 3 minutes, however fast each event was.

## What changed because of this

- **Inbox:** paged (`GET /chat/conversations?limit=50`, then `beforeUpdatedAt`/`beforeId`). The
  first page of a 440-chat inbox is about 3 times faster, and the poll every 15 seconds reads 50
  conversations instead of all of them.
- **Dispatcher:** after a full batch it keeps going, up to 50 batches a tick, instead of waiting 2 s.
- **Indexes: none added.** History already uses `chat_messages(conversationId, createdAt)` with an
  incremental sort on `id`; the plan reads 7 buffers and runs in under 0.1 ms in Postgres. The
  suggested `(conversationId, createdAt, id)` index would save that sort and nothing measurable.
  Unread totals use `chat_message_receipts(userId, readAt)`.

## Not measured

- A real network hop to Neon: every query above pays it once more per round trip, which dominates
  at these sizes.
- Kafka itself, and the notification consumer.
- Unread chats total (71 ms) is the slowest count; it is not polled by any client yet.
