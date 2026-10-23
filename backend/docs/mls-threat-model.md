# MLS chat encryption — threat model

The first part is the current threat model, checked against the code on
22 October 2026. The second part is the history: the decisions as they were
made, with their dates. Where the two disagree, the current part is right.
When the code changes what is protected, update the current part and add a
dated note to the history.

## Current threat model (22 October 2026)

### What is protected, and against whom

- Message text, attachments and link preview cards are encrypted with MLS
  (`ts-mls`) on the sending device. The server, the database and the storage
  provider only hold ciphertext.
- This protects against passive compromise (a database snapshot, a leaked
  backup, a subpoena) and network eavesdropping.
- The server is the key directory and the membership authority. A malicious
  server can register a device under someone's account or fake membership,
  and clients will accept it. Safety numbers are the only defence, and only
  for people who compare them (below).

### Identity and safety numbers

- An MLS member is a device, not a user. Each device has its own MLS
  identity and signature key (`ChatDevice`, at most 10 active per user).
- Clients check that every credential in a Commit, Welcome or self-join
  matches the `userId`/`deviceId` it claims. This catches buggy or tampered
  clients, not a server that lies about keys.
- Safety numbers are built (`frontend/lib/mls/verification/`). A number is a
  SHA-256 over the signature keys of the devices this device sees in its own
  copy of the group tree, not the server's list. Both people compare one
  pair number out of band.
- Verification is stored per pair of users, encrypted on this device only.
  If a verified peer adds a device, the chat shows "New device"; if a
  verified device's key changes, it shows a red alert.
- In groups, each device derives "X joined" and "X left" notices itself from
  the Commits it verified (`membershipEvents.ts`), so they do not depend on
  the server telling the truth. Someone adding a device gets no notice in the
  chat (removed 23 October 2026, as too device-level for a chat); only a
  verified peer's new device shows, through the safety-number badge above.

### Membership

- The server's `ChatParticipant` rows decide who may be in a conversation;
  MLS decides who can read it. Clients compare the whole MLS tree against
  the server roster and treat a mismatch as an error.
- Adds and removes are ordinary Commits by an online member's client. There
  is no `external_senders`: the server never proposes anything. Removals
  (leave, kick, ban, revoked or dormant device) are picked up by any online
  member through membership work (`membership-work.ts`).
- A device with no one online to add it joins by external commit against the
  latest signed `mls_group_infos` snapshot; the server checks the signature.
- A group invitee (`PENDING`) is in the MLS group from invite time. An
  ignored invite expires after 14 days. A key-package claim for a pending
  invitee rechecks blocks and the `NO_ONE` setting at claim time.
- Sends are refused while a member is `LEAVING`, so a leaf that is about to
  be removed cannot read them. The sender's client removes it and retries.
- Devices unseen for 60 days are retired. At the 10-device cap the
  least-recently-seen device is evicted, or the new device is refused if all
  ten were used in the last 14 days.

### Storage and history

- A message key can be used once (forward secrecy). Each device decrypts a
  message once and keeps the plaintext in IndexedDB, encrypted with a
  non-extractable WebCrypto key.
- A received message's plaintext is saved before the advanced ratchet state,
  so a crash in between cannot lose it (F08, #98). A send the server
  accepted is reported as sent even if keeping the local copy fails.
- A new device cannot read messages from before it joined. The thread shows
  a banner instead of an empty history.
- Optional history backup (`chat-backup`) uploads each message's plaintext
  again, encrypted with AES-GCM under a recovery key only the user holds and
  bound to the user, conversation and message ids. Without the key nobody
  can open it, and it cannot be reset.

### Concurrency and lost commits

- Every change to a conversation's group state, sends included, runs under a
  Web Locks cross-tab lock for that device and conversation. If the browser
  has no Web Locks, secure sending is refused instead of letting two tabs
  reuse a sender generation (F01, #92).
- When two Commits race for an epoch, the server answers 409 with
  `outcome: 'conflict'` and the winning handshake. The exception filter
  passes exactly those two fields through, and the losing client applies the
  winner and retries (F07, #97).

### Attachments and link previews

- Files and thumbnails are encrypted on the device with AES-256-GCM, a fresh
  key and IV per file (`frontend/lib/mls/media/`). The key, IV, SHA-256,
  name and type travel inside the MLS message. The server and storage
  provider see only opaque blobs, their sizes, and whether each is a file or
  a thumbnail.
- Link previews are fetched by the server (`POST /link-previews`), so the
  server sees every link someone previews in chat and caches the result in
  Redis for 6 hours, keyed by a hash of the link. The card and its picture
  are then encrypted like an attachment.

### Metadata the server sees in plaintext

- Who talks to whom, when, how often, and how big each message is.
- `contentType`, `replyToId`, reactions (`emoji`/`emoteId`), and
  `mentionUserIds` (the people a message @mentions, sent beside the
  ciphertext so notifications work).
- The ids of attached blobs, and the links that get previewed (above).
- `encryptionMeta` is a free-form object capped at 20000 characters of JSON.
  Nothing structurally stops a buggy client from putting plaintext in it.

### Logging

- Only 5xx errors go to Discord, with the query string stripped from the
  path and fields truncated to Discord's limits. There is no dedicated
  redaction of key packages, Welcomes or ciphertext: no server code is known
  to put them in an error message, but nothing prevents it either.
- Outside development, a 5xx answer tells the client only "Something went
  wrong" and leaves out the error code.

### Retention

- Pruned daily: consumed Welcomes after 30 days, Welcomes of revoked
  devices, commit faults after 180 days, and claimed single-use key packages
  30 days after claim. Expired key packages are purged hourly.
- Never pruned: `mls_handshakes` (members catch up by replaying every
  Commit) and removed `mls_group_members` rows (lagging members need the old
  roster).

### Known gaps

- A fully malicious server is only caught by people who compare safety
  numbers. There are no member-signed invites and no key transparency.
- Verification lives on one device and does not follow a user to their
  other devices.
- "Delete for everyone" relies on every recipient's client deleting its
  local copy, and open windows and the local plaintext store are not all
  told yet (#102).
- The server sees previewed links and the metadata above.
- Logging has no dedicated redaction of MLS bytes.

## History

The decisions below were written from 14 to 25 September 2026 and are kept
as they were, with the notes added at the time. Several are superseded, some
more than once; the current part above is what holds now. In particular,
the plan below says safety numbers and encrypted attachments were deferred;
both have since been built.

### 1. What server compromise means for this system (2026-09-14)

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

### 2. Device model (2026-09-14)

**Decided:** an MLS member is a device, not a user. `ChatParticipant`,
receipts, and socket rooms (`userRoom(userId)`) all stay user-scoped for
everything they already do (permissions, notifications, UI). A new
`ChatDevice` table sits underneath, one user having 1+ devices, each device
holding its own MLS identity and key packages.

- Logging out must not delete the device or its keys — only revocation
  does: explicit "log out this device everywhere", dormancy retirement, cap
  eviction of the least-recently-seen device, or account deletion.
- A device whose local storage is wiped (cleared browser data, reinstall)
  becomes a dead member of every group it was in — it can never come back
  online to be cooperatively removed. Needs a cleanup mechanism (staleness
  timeout + forced removal via `external_senders`, see §5).
  **Superseded (2026-09-22):** built without `external_senders`, which was
  never implemented. A 10-device-per-user cap plus a nightly job that retires
  devices unseen for 60 days keeps the count bounded (at the cap, the
  least-recently-seen device is evicted, or the registration is refused if
  every device was used recently); membership work
  (`membership-work.ts`) then removes a retired device's leaf the next time
  any online member's client does a full reconcile pass — an ordinary Remove
  by that member's own client, not a server-proposed one.

**Decision (2026-09-14):** no formal device-approval flow for v1. GachaHub
is web-only today — no iOS/Android app — so "a new device" mostly just
means "logged in from a browser this account hasn't used before," not the
multi-device scenario Signal's linked-device flow is built for. A new
device still registers silently on login, with device changes surfaced as
a visible notice in the conversation ("Bob added a new device").

**Not built yet (2026-09-25):** that in-conversation notice does not exist.
A new device is added silently and nothing in the chat UI says so; "client-
generated 'X joined' notices" and a per-user device list are still in the
planned upgrades at the end of §8. The decision stands, the notice is owed.

Login-location anomaly flagging (warn the user when a login comes from a
very different location/IP than usual) is a related but separate feature —
tracked in `BACKLOG.md`, not a blocker for the encryption work in this
branch.

### 3. Membership authority — who authorizes adds/removes (2026-09-14)

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

**Superseded (2026-09-23):** reversed. `PENDING` is now an entitled state
(`leaf-entitlement.ts`) — a group invitee's device is added, and they can
call `findMessages`, from the moment they're invited, not from accept.
Accept/decline still exist, but as a request-inbox affordance layered on top
of already-real access, not a gate on it (matching Kawaii Moe's team's
discussion linked from this branch's history).

This does **not** mean an invitee reads the group's actual full history.
MLS forward secrecy means a device only derives the group's *current* epoch
secret from the Commit that adds it — it cannot derive any earlier epoch's
secret, so anything sent before that Commit stays permanently
undecryptable to them, at any access speed. What this decision actually
buys an invitee is: readable from *invite time* forward instead of from
*accept time* forward (the gap between the two, previously wasted). "Read
the whole chat" was the original ask; it is not what MLS can deliver here
without changing how far back a Welcome's secrets reach, which this change
does not attempt.

New gaps this decision opens, not yet fully closed:
- **Invite expiry** — `isLeafRemovable` treats PENDING as entitled with no
  time limit, and nothing ever declines a stale invite on its own. An
  ignored invite is permanent cryptographic membership: their device keeps
  receiving every future epoch secret indefinitely.
  `chat-invite-expiry.service.ts` (added 2026-09-23) expires one after 14
  days of no response, routing it through the same REMOVE→LEAVING pipeline
  as an admin removal. Expiry keys off `chat_participants.pendingSince` (when
  the row entered PENDING, not `updatedAt`) and sweeps in batches. The daily
  run first stamps `pendingSince = now()` on PENDING rows that lack one
  (written by older code mid-deploy), so they expire 14 days later; the
  migration backfilled open invites with `now()`, a fresh 14-day grace.
- **Stale consent at claim time** — the mutual-follow/messageRequestSetting
  check that decides ACTIVE vs PENDING only runs once, at invite time.
  Because PENDING is now entitled, a later key-package claim for a
  still-pending invitee re-checks the DM consent gate fresh
  (`assertMayClaimForGroup`), since an old invite is not standing consent to
  actually receive key material later, particularly if the target changed
  their settings or blocked the inviter in between. Only `NO_ONE` and blocks
  (either direction) are rechecked; `FOLLOWERS` was judged against the real
  inviter at invite time. The membership-work endpoint applies the same check
  and leaves out such invitees, so they don't sit in every member's work loop.
- **Decline briefly holds up the next send** — `DECLINE_INVITE` now routes
  through `LEAVING` when the invitee already holds a leaf (same as any REMOVE),
  and `assertNoMembershipChangePending` refuses sends in the conversation while
  anyone is LEAVING, because a leaf still in the tree could decrypt them. This is
  not a standing outage: only someone online and sending is affected, and their
  own client resolves it - `sendEncryptedChatMessage` catches the refusal, runs
  `reconcileMembership` (an ordinary Remove Commit by that member), and retries
  under the new epoch. With nobody online nobody is sending, so there is nothing
  to hold up. The cost is a short extra delay on the first send after a decline.
  A member cannot Commit their own removal (RFC 9420), so the decliner's device
  can't do it faster; the IETF SelfRemove draft (`draft-mahy-mls-selfremove`)
  would let any member or external joiner commit a signed leave proposal, and is
  the thing to look at if that delay ever matters.

### 4. Direct messages need devices to exist first (2026-09-14)

**Decided:** `createDirectMessage` currently creates the conversation and
first message in one step. Under MLS, sending the first DM requires, in
order: fetch the recipient's (and the sender's other devices') key
packages → create the group and add those devices → upload Welcomes, the
commit, and the first message together. If the recipient has zero
registered devices (never logged in on a device that generated one), the DM
cannot be created yet. The UI needs an explicit state for this — not a
generic error.

### 5. History does not survive reload — by design (2026-09-14)

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

### 6. Metadata the server still sees in plaintext (2026-09-14)

Written down so nobody assumes more privacy than actually exists:

- `contentType`, `replyToId`, reaction `emoji`/`emoteId` — all plaintext
  columns today, unencrypted by MLS since MLS only wraps the message body.
- Who's messaging whom, when, how often — full social graph and timing.
- `encryptionMeta` is an untyped `@IsObject()` field, now capped at 20000
  characters of JSON (`BoundedJsonSizeConstraint`). Nothing stops a buggy
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

  **Superseded (2026-09-23):** not built, and deliberately deferred rather
  than in progress. Chat messages still attach `mediaUploadId`s, and
  `uploadPostMedia`/`uploadToCloudinary` (`frontend/lib/api.js`) still post
  raw files straight to Cloudinary. This is the one gap of the four
  2026-09-14 decisions this doc doesn't otherwise mark superseded or done -
  written down explicitly so "required for v1" above doesn't read as
  current status. Media sent through chat today is plaintext to the
  storage provider, same as any other attachment on this app; nothing in
  the product UI currently says so.
- "Delete for everyone" only works if every recipient's client cooperates
  (deletes its local plaintext copy). The server can't force this. UI copy
  must not promise permanent deletion from other people's devices.

### 7. Logging hygiene (2026-09-14)

**Decided:** `DiscordLoggerService` (on `main`) already sends request paths,
error messages, and stack traces to Discord on 5xx. Before any MLS
endpoint ships: audit that no validation error, parse failure, or exception
message can ever include raw key package bytes, Welcome bytes, or
ciphertext — those should be truncated/redacted at the same point stack
traces already are, not trusted to "just not come up."

### Summary of decisions (2026-09-14)

1. Fingerprint/safety-number verification — deferred to fast-follow, not v1.
2. New device approval — silent registration, with a visible in-conversation
   notice. Login-location anomaly flagging tracked separately in
   `BACKLOG.md`, not part of this branch.
3. Pending group invites — added to the MLS group only on accept. Still
   needs a queued/retry design for "no existing member is online at
   accept-time" (see §3). **Superseded (2026-09-23):** reversed - a group
   invitee is added on invite, not accept. See §3's 2026-09-23 note for what
   this does and doesn't get them, and the gaps it opened.
4. Media encryption — required for v1. Files encrypted client-side before
   upload, key travels inside the MLS message. **Superseded (2026-09-23):**
   deferred, not built - see §6.

All four decisions above are locked in as the intended design; #4 is not yet
implemented (see §6). The library question is settled (`ts-mls`) and the core
encryption path is built; what remains open is listed in `BACKLOG.md`.

### 8. Update (2026-09-22): what the running code actually defends

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

### 9. Retention (2026-09-25): what is pruned, and what is kept on purpose

`MlsRetentionService` (`src/mls-retention/`, daily 5am) prunes, in batches:

- consumed `mls_welcomes` older than 30 days;
- unconsumed `mls_welcomes` of revoked devices (they never poll again);
- `mls_commit_faults` older than 180 days;
- claimed `SINGLE_USE` `mls_key_packages` 30 days past `claimedAt` (expired
  ones are purged hourly by `MlsKeyPackageCleanupService`);

`mls_group_members` is not pruned: removed rows (`removedEpoch` set) rebuild
the roster for members lagging on old epochs.

**Decided: `mls_handshakes` is never pruned.** A member catches up by applying
every Commit in order from its own epoch, so deleting any row would strand
every member behind it, and the joining/roster checks read old epochs. The log
is bounded by retiring dormant devices (60 days), not by deleting history.
The same applies to `mls_group_infos` (one row per conversation, replaced in
place). Revisit only with a snapshot/checkpoint scheme, which does not exist.

**Welcomes paging.** `GET .../welcomes?after=<welcomeId>` resumes past that
Welcome (oldest first) so ones a client cannot consume never starve newer
ones. A cursor that is not one of the device's Welcomes is a 400, so the
client restarts deliberately instead of silently re-paging from the top.

**Indexes added for these paths:** partial `chat_participants(pendingSince)
WHERE state = 'PENDING'`, `mls_welcomes(conversationId)`,
`mls_group_members(deviceId, removedEpoch)` (replaces `(deviceId)`), and a
`pg_trgm` GIN on `user(name)` for the picker search. There is no
`chat_devices(lastSeenAt)` index. They are built `CONCURRENTLY ... IF NOT
EXISTS`: a failed build leaves an INVALID index that a retry silently skips,
so check `pg_index.indisvalid`, `DROP INDEX CONCURRENTLY` it, then re-run.

### 10. Update (2026-10-22): current summary added

Moved everything above into this history and wrote the current threat model
at the top (#106). Since 25 September: safety numbers and client-derived
device notices were built, attachments and link preview cards are encrypted,
history backup exists, `mentionUserIds` became new plaintext metadata, and
the audit's MLS fixes landed: no sending without Web Locks (F01, #92), the
409 conflict keeps the winning handshake (F07, #97), and plaintext is saved
before the ratchet (F08, #98).
