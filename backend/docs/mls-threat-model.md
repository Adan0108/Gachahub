# MLS chat encryption — threat model and decisions

Step 0 of the E2E encryption plan. Everything downstream (library choice,
schema, wrapper design) depends on these being settled first, not discovered
mid-implementation.

Items marked **Decided** are the default this doc proposes — flag if you
disagree. Items marked **OPEN** are product/UX calls only you can make;
implementation should not proceed on those paths until one is picked.

## 1. What server compromise means for this system

**Decided:** v1 assumes the server is honest about identity binding. An MLS
`BasicCredential` is just a name string — nothing cryptographically proves a
key package belongs to the userId it claims. The server is what maps key
packages to users today, so a compromised server (or a bug that lets one user
upload a key package under another user's identity) can silently insert a
device into any conversation.

This is a real gap, not a hypothetical one. Written down explicitly instead
of silently assumed:

- E2E in this system protects against passive server/DB compromise (a
  snapshot, a subpoena, a leaked backup) and network eavesdropping.
- It does **not** protect against an actively malicious server that lies
  about key packages, unless out-of-band verification (below) is used.
- Mitigation for v1: the client validates that every credential in an Add,
  Welcome, or Commit matches the `userId`/`deviceId` it claims to be, so a
  *mismatched* forged credential is caught. It does not catch a forged
  credential that correctly claims to be a device the attacker registered
  under a victim's account via a server bug — that's a backend authorization
  bug, not an MLS problem, and gets caught by normal backend security review.

**Decision (2026-09-14):** fingerprint/safety-number verification is
deferred to a fast-follow, not v1. Out-of-band key verification is the only
thing that catches a truly malicious server, and it's a real gap in v1's
threat coverage — written down here so it stays a conscious tradeoff, not a
silently-skipped feature.

## 2. Device model

**Decided:** an MLS member is a device, not a user. `ChatParticipant`,
receipts, and socket rooms (`userRoom(userId)`) all stay user-scoped for
everything they already do (permissions, notifications, UI). A new
`ChatDevice` table sits underneath, one user having 1+ devices, each device
holding its own MLS identity and key packages.

- Logging out must not delete the device or its keys — only revocation
  (explicit "log out this device everywhere" or account deletion) does.
- A device whose local storage is wiped (cleared browser data, reinstall)
  becomes a dead member of every group it was in — it can never come back
  online to be cooperatively removed. Needs a cleanup mechanism (staleness
  timeout + forced removal via `external_senders`, see §5).
  **Superseded (2026-09-22):** built without `external_senders`, which was
  never implemented. A 10-device-per-user cap plus a nightly job that retires
  devices unseen for 60 days keeps the count bounded; membership work
  (`membership-work.ts`) then removes a retired device's leaf the next time
  any online member's client does a full reconcile pass — an ordinary Remove
  by that member's own client, not a server-proposed one.

**Decision (2026-09-14):** no formal device-approval flow for v1. GachaHub
is web-only today — no iOS/Android app — so "a new device" mostly just
means "logged in from a browser this account hasn't used before," not the
multi-device scenario Signal's linked-device flow is built for. A new
device still registers silently on login, with device changes surfaced as
a visible notice in the conversation ("Bob added a new device").

Login-location anomaly flagging (warn the user when a login comes from a
very different location/IP than usual) is a related but separate feature —
tracked in `BACKLOG.md`, not a blocker for the encryption work in this
branch.

## 3. Membership authority — who authorizes adds/removes

**Decided:** the server's `ChatParticipant` rows remain the source of truth
for *who is allowed to be in a conversation*; MLS enforces *who can
cryptographically read it*. The two must be kept in sync in the same
transaction (see the reordered plan's step 5) — a client should treat a
mismatch between the server roster and the MLS member list as a bug/warning,
never as something to silently paper over.

- **Adds:** authorized the same way they are today (mutual-follow check,
  message-request setting) — MLS Add is just the cryptographic side effect
  of an already-authorized server decision.
- **Removes (voluntary leave):** RFC 9420 doesn't let a member remove
  themselves — they propose, another online member commits. If no member is
  online, the leave is queued until one is (or the server's
  `external_senders` key proposes it, see §5).
- **Removes (bans, deleted accounts, stale devices):** no ordinary client
  will ever proactively remove these. Use RFC 9420 `external_senders` so the
  server itself can propose a Remove, which any online member's client then
  commits. Client rule: accept an external proposal only when it's a Remove
  — never accept an external Add, or the server could silently insert an
  attacker's device using the same mechanism meant for cleanup.

**Superseded (2026-09-22):** `external_senders` was never built. Removals of
every kind — voluntary leave, ban, stale device — instead go through
`membership-work.ts`: the server marks who is no longer entitled to a leaf
(participant state, revocation, dormancy), and any online member's client
picks that up as ordinary Remove work on its next poll and commits it itself.
No server-proposed Remove exists, so the "never accept an external Add"
client rule above was never load-bearing — there is no external proposal
path in the shipped design for a client to accept or reject.

**Decision (2026-09-14):** option (a) — a pending group invitee is added to
the MLS group only once they accept, matching today's product behavior
(pending = no history access).

Known operational gap this creates: adding someone to an MLS group is a
cryptographic operation only an *existing, currently-connected* member's
client can perform — the server can't do it alone. If every existing member
happens to be offline the moment someone clicks Accept, the accept can't
complete immediately. Needs a queued/retry design (process the pending add
the next time any existing member's client comes online) plus a "syncing…"
UI state for the accepter instead of a silent failure. Not solved yet —
flagging so it isn't discovered mid-implementation.

**Superseded (2026-09-22):** solved by MLS external commits, not the
queued/retry design sketched above. Every accepted Commit publishes a signed
snapshot (`mls_group_infos`); a device with nobody online to add it fetches
that snapshot and joins by itself (`mls-self-join.*`, `syncEngine.ts`'s
`joinByExternalCommit`), with the server verifying the join's signature
against the same snapshot before accepting it. No existing member needs to
be online at accept time. The "syncing…" UI state is still not built.

## 4. Direct messages need devices to exist first

**Decided:** `createDirectMessage` currently creates the conversation and
first message in one step. Under MLS, sending the first DM requires, in
order: fetch the recipient's (and the sender's other devices') key
packages → create the group and add those devices → upload Welcomes, the
commit, and the first message together. If the recipient has zero
registered devices (never logged in on a device that generated one), the DM
cannot be created yet. The UI needs an explicit state for this — not a
generic error.

## 5. History does not survive reload — by design

**Decided:** MLS deletes each message's key immediately after one decrypt;
that deletion is what provides forward secrecy. A client cannot re-decrypt
`ciphertext` fetched from `findMessages` after a page reload — there is no
"decrypt on read" in the way the current disabled UI copy implies.

- Clients decrypt once, at arrival, and persist the *plaintext* in an
  encrypted local store (IndexedDB, encrypted with a non-extractable
  WebCrypto key — see the wrapper-design doc for specifics).
- A brand new device has no history. This is intended MLS behavior, not a
  bug — but the UI must say so explicitly ("messages sent before this
  device joined aren't available here") instead of showing an empty or
  broken-looking thread.

## 6. Metadata the server still sees in plaintext

Written down so nobody assumes more privacy than actually exists:

- `contentType`, `replyToId`, reaction `emoji`/`emoteId` — all plaintext
  columns today, unencrypted by MLS since MLS only wraps the message body.
- Who's messaging whom, when, how often — full social graph and timing.
- `encryptionMeta` is an untyped `@IsObject()` field. Nothing stops a buggy
  client from accidentally putting plaintext in it. Needs a stricter shape
  once the real envelope format is decided (see reordered plan, item C4).
- **Decision (2026-09-14):** media must be E2E encrypted too, not left as a
  gap. `MediaUpload` goes to the storage provider unencrypted today — files
  get encrypted client-side before upload, with the file key traveling
  inside the MLS message (same pattern as the message body). The storage
  provider only ever sees ciphertext bytes, same as the backend does for
  message text. This is real added scope for the frontend/backend media
  flow, not a small tweak — needs its own pass once the core message
  encryption is working.
- "Delete for everyone" only works if every recipient's client cooperates
  (deletes its local plaintext copy). The server can't force this. UI copy
  must not promise permanent deletion from other people's devices.

## 7. Logging hygiene

**Decided:** `DiscordLoggerService` (on `main`) already sends request paths,
error messages, and stack traces to Discord on 5xx. Before any MLS
endpoint ships: audit that no validation error, parse failure, or exception
message can ever include raw key package bytes, Welcome bytes, or
ciphertext — those should be truncated/redacted at the same point stack
traces already are, not trusted to "just not come up."

## Summary of decisions (2026-09-14)

1. Fingerprint/safety-number verification — deferred to fast-follow, not v1.
2. New device approval — silent registration, with a visible in-conversation
   notice. Login-location anomaly flagging tracked separately in
   `BACKLOG.md`, not part of this branch.
3. Pending group invites — added to the MLS group only on accept. Still
   needs a queued/retry design for "no existing member is online at
   accept-time" (see §3).
4. Media encryption — required for v1. Files encrypted client-side before
   upload, key travels inside the MLS message.

All four decisions above are locked in. Remaining open question before
coding starts: the reordered plan's step 1 (`MlsClient` contract tests)
and step 2 (library bake-off) are next.

## 8. Update (2026-09-22): what the running code actually defends

Written against the `feat/chat-e2e-encryption` branch, so §1's decision stays
honest as features land.

**The server is the key directory AND the membership authority.** Every check
clients run (per-commit declarations, the whole-tree-vs-roster comparison, the
self-join rules) compares against the server's own records. They catch buggy
or tampered *clients*, and passive database compromise - not a fully malicious
server, which can register keys and fabricate membership it then attests.

- The one-way "declared" marker stops a server *downgrading* verification for
  a group, nothing more.
- The integrity sweep (`common/integrity`, checks in `mls-integrity-checks.ts`) runs on the same server and data
  it checks: it catches bugs and stuck flows, not tampering.
- Session-link signatures are domain-separated (`gachahub/session-link/v1`),
  so the server cannot use the link flow as an oracle to obtain a device's
  signature over an MLS structure.
- Self-join commits are signature-verified server side, so holding a login
  cookie without the device's private key is not enough to submit one.

Planned upgrades, in cost order: client-generated "X joined" notices, a
per-user device list, member-signed invites, key transparency / safety
numbers (see BACKLOG.md).
