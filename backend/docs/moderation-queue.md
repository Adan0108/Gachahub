# Moderation queue contract and query bounds

For the full report/worker/policy flow and freshness-state decision order, see the
[moderation pipeline walkthrough](moderation-pipeline.md).

Both `GET /moderation/cases` and `GET /games/:gameSlug/moderation/cases` use the
same repository enrichment. Existing authorization and workflow rules still apply.

Each case summary adds:

```ts
targetState: 'available' | 'deleted' | 'missing';
targetPreview: {
  title: string | null;       // at most 160 characters
  excerpt: string;            // at most 240 characters, whitespace collapsed
  thumbnailUrl: string | null;
  author: { id: string; name: string; username: string | null; image: string | null };
} | null;
reasonSummary: Array<{ reasonCode: ReportReason; count: number }>;
```

Deleted/missing targets have a null preview and an explicit state. Comments inherit
their post's deletion state. A thumbnail is the first HTTP(S) image by sortOrder/id;
videos and unusable URLs are skipped. Public preview text is bounded inside
PostgreSQL; full current title/content are loaded privately for canonical freshness
hashing. The list contains no reports collection, snapshots, full content, media collection or storage
identifiers. Detail returns the current target separately and includes the same
reason aggregation alongside its bounded evidence page. Stage 2D.4 adds the same
compact `aiAdvisory` union to case list/detail; only CURRENT carries policy output.
Legacy case risk fields are not populated from this projection.

Reasons are grouped from surviving complaints for the current case IDs only, then
ordered by count descending and reason code ascending. There are at most ten groups
per case with the current reason enum. Stored report/reporter counters can exceed
surviving evidence after account deletion; reads do not rewrite them.

## Query measurements

Before Stage 2D.4, focused Prisma SQL logging against development PostgreSQL
measured the repository with populated game, assignee and resolver relations:

| Operation | 20 rows | 50 rows |
| --- | ---: | ---: |
| Case page, including one lookahead | 1 | 1 |
| Batched game/assignee/resolver relation reads | 3 | 3 |
| Combined POST/COMMENT preview query | 1 | 1 |
| Report GROUP BY caseId/reasonCode | 1 | 1 |
| Total | 6 | 6 |

Those historical counts exclude fixed authentication/scope checks and the new
advisory query/transaction overhead. Current nonempty pages add exactly one batched
highest-generation/active-policy query. The Stage 2D.4 PostgreSQL/HTTP regression
fixture measures 11 total SQL statements at 20, 50 and 100 cases, including its
authorization, relation and read-only transaction statements; different populated
relations/scopes can change fixed overhead. All freshness contributors share one
REPEATABLE READ, READ ONLY transaction. Empty relations can reduce the number of
relation reads. Preview media uses an indexed lateral lookup with
LIMIT 1 inside the single SQL statement; it does not create client round trips.
The report caseId index supports restricting aggregation to the current page.
There are no per-case repository calls, and the browser queue uses one list request
without detail/evidence requests per row. Repository tests enforce one preview
batch, one reason aggregation and one advisory batch for 20, 50 and 100 cases.

## Pagination

All four native queue/evidence endpoints use cursor pagination only. The first
request sends `limit=20` and omits cursor; later requests send the opaque
`nextCursor`. Detail includes the first 20 evidence items in `evidence`, using
the same envelope:

```ts
{ items, nextCursor: string | null }
```

| Endpoint | Filters alongside cursor/limit |
| --- | --- |
| `/moderation/cases` | status, targetType, scope; gameSlug only with scope=game |
| `/games/:gameSlug/moderation/cases` | status, targetType |
| `/moderation/cases/:caseId/reports` | none; evidence stays scoped to caseId |
| `/games/:gameSlug/moderation/cases/:caseId/reports` | none; exact game and case |

Case cursors encode `{lastReportedAt,id}` and order by lastReportedAt DESC, id DESC.
Evidence cursors encode `{createdAt,id}` and order by createdAt DESC, id DESC.
Both use an exclusive tuple boundary and limit+1 lookahead. The boundary row need
not survive for its cursor to remain usable. Changing filters starts a new traversal; filters
and authorization apply to every request. Limits default to 20 and are capped at
100. Numbered pages, pagination modes and total-count metadata are not supported
by these native endpoints. Unrelated legacy endpoints retain their own contracts.
Keep the same filters while following nextCursor; page/pagination query parameters
are rejected with HTTP 400 rather than selecting another pagination model.

Queue navigation keeps the visited cursor boundaries for Previous/Next actions.
Evidence uses Load more reports. Neither traversal counts all cases or skips
earlier rows. New arrivals and case edits can change a revisited batch; this is a
live queue rather than a frozen snapshot.

No schema migration, speculative reason-stat table or AI behavior was introduced.
These measurements validate bounded query shape, not throughput at 100,000 daily
reports. Production-volume query plans and load measurements should guide any
additional indexes or aggregation changes.
