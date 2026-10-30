# Economy, Cosmetics and Gachahub+ — plan

Source of truth for currencies, cosmetics, pulls and the subscription. Change this file when a decision changes, and add a line to the decision log at the bottom.

Status: **planned, not started** (decided 2026-10-29).

---

## 1. Goals and non-goals

**Goals**
- Give people a reason to come back daily and to make their profile theirs: a Steam + Discord hybrid (profile background, hover mini profile, avatar frame, banner, animated avatar).
- A way to make money (Gachahub+) that never sells power, only looks.
- Reward good social behaviour (liked posts and comments) without making it farmable.

**Not in the MVP**
- Real payments (admins grant Gachahub+ for now).
- Aura (prediction markets, Kalshi/Polymarket style). Its own plan later.
- Text effects.
- The suspicious-activity detection system (a simple hidden rule stands in for it, section 4.4).
- Vietnamese phone verification (separate launch blocker, see section 10).

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Reputation** | Social standing. Earned from likes and comments received; shown on the profile; never bought, never spent in the MVP; never decays. |
| **Rank** | Stargazer → Meteor → Comet → Nova → Supernova → Galaxy, from Reputation earned in the last 90 days. Drops when inactive. |
| **Shards** | Free currency. Earned slowly; spent on Shard pulls. Never bought. |
| **Prisms** | VIP currency. Only from Gachahub+ (300 per month). Spent on Prism pulls. |
| **Aura** | Post-MVP prediction score. Nothing built now. |
| **Gachahub+** | The subscription. |
| **Case** | A pool of items you pull from, priced in one currency. *Standard* (permanent) or *Featured* (3 weeks). |
| **Pull** | One random draw from a case. ×1 or ×10. |
| **Rarity** | Dust ★ (refund), Glint ★★ (bigger refund), Glimmer ★★★, Radiant ★★★★, Prismatic ★★★★★. |
| **Pity** | Guarantees: a Radiant-or-better within every 10 pulls; a Prismatic by pull 80 (Shards) / 50 (Prisms). |
| **Spark** | 1 point per pull in a case; enough points let you pick any item in that case. |
| **Slot** | Where a cosmetic goes: Frame, Profile background, Mini background, Banner (Text effect later). |
| **Established account** | An account whose likes earn others Reputation/Shards. Rule is hidden (section 4.4). |
| **Ledger** | Append-only record of every balance change. Balances are a cache of it. |

---

## 3. Currencies

| | Reputation | Shards | Prisms |
|---|---|---|---|
| How you get it | Likes and comments received from established accounts, in daily steps | Daily check-in, likes, milestones | Gachahub+ monthly allowance, pull refunds |
| Can be bought | Never | Never | Only through Gachahub+ (no packs in MVP) |
| Can be lost | Moderator removes the content that earned it | Spent on pulls; moderator removal claws back | Spent on pulls |
| Can go below 0 | No | No | No |
| Tradeable / giftable / cash-out | No | No | No |
| Shown | On profile and hover card | Own wallet only | Own wallet only |

Integer amounts only. Every change is one ledger row with a reason and an idempotency key (section 11).

---

## 4. Earning

### 4.1 Rates

**Reputation (received by the post/comment owner), per author per UTC+7 day, in steps:**

| Source | Step 1 | Step 2 | Step 3 |
|---|---|---|---|
| Counted likes received | 1 point per like, up to 200 points | 1 point per 10 likes, up to 1,000 points | 1 point per 100 likes after that |
| Counted comments received | 1 point per comment, up to 100 points | 1 point per 5 comments, up to 500 points | 1 point per 20 comments after that |

- No hard daily cap: a viral day keeps paying, just slower (1M likes in a day ≈ 11k Reputation).
- **Per-liker brake:** one person can give the same author at most **5 Reputation per day** (likes and comments together). Likes/comments past that still count socially and for milestones. It is per author, so liking 5 posts by 5 different people never "uses up" anything for a 6th author.
- **Counted like:** from an established account (4.4), not your own, once per (liker, post/comment) ever.
- **Counted comment:** from an established account, not on your own post, only the **first** comment per commenter per post counts (replies and repeats don't), not the post owner's replies.
- Liking or commenting **never** earns the actor Reputation (that would reward spam-liking).
- Steps are computed from the day's counted totals: credit = `points(countToday) − creditedToday`, so no fractions; each credit is a ledger row attributed to the post/comment that triggered it (needed for clawback, 4.5).
- Reputation is never multiplied by Gachahub+.

**Shards:**

| Source | Shards |
|---|---|
| Daily check-in (button) | 10 |
| Each counted like received | 1 |
| Each counted comment received | 1 |
| Your post/comment reaching 10 / 50 / 100 counted likes | 5 / 20 / 50 |
| First 3 comments you write on other people's posts each day | 1 each |
| Daily cap | 60 (90 with Gachahub+, ×1.5 on everything) |

Shards keep a hard daily cap because they buy things.

### 4.2 Day boundary
- One "day" for caps and check-in is **00:00–24:00 Asia/Ho_Chi_Minh (UTC+7)** for everyone, using server time only. Simple and matches the main audience.
- *Edge:* users in other time zones see the reset at an odd local hour. The wallet shows "resets in Xh" so it is never a surprise.

### 4.3 Multiplier without fractions
- Problem: ×1.5 on a 1-Shard like is 1.5 Shards.
- Solution: keep a per-user per-day counter of *base* Shards earned. Each award credits `floor(baseToday × multiplier) − creditedToday`. Over a day the total is exactly ×1.5, and no fractional balances exist.
- The cap applies to the credited amount (60 or 90).

### 4.4 Established account (hidden)
- A like earns the post/comment author something only if the **liker** is established: account at least N days old, at least P posts or C comments, status ACTIVE.
- N, P, C are **different per account**: derived from `HMAC(secret, likerId)` into ranges N 5–10 days, P 1–2 posts or C 3–5 comments. The secret lives in env config, so the rule cannot be worked out from user ids.
- The rule is never shown in the UI, API responses, errors or public docs. A like that earns nothing looks exactly like one that earns something to everyone except the ledger.
- Checked **at the moment of the like**. A liker who becomes established later does not award old likes retroactively.
- Replaced by the real suspicious-activity system after the MVP.

### 4.5 Earning edge cases

| Case | What happens | Why |
|---|---|---|
| You like your own post/comment | Like works, earns nothing | Self-farming |
| Like → unlike → like again | Earns once per (liker, post/comment) ever. Idempotency key `like:{targetType}:{targetId}:{likerId}` | Cycling would farm |
| Unlike after it earned | No clawback | Lets a liker grief someone by un-liking; amount is 1 |
| Daily Shard cap reached | Like still counts socially; Reputation still awarded; no Shards, no Shard ledger row | Shard cap only limits currency |
| One person already gave you 5 Reputation today | Their likes/comments still count socially and toward Shard milestones; no Reputation from them until tomorrow (UTC+7 day) | Per-liker brake, per author |
| You pass 200 like-points in a day | Next likes pay 1 point per 10 likes; after 1,000 points, 1 per 100; resets next day | Daily steps |
| Same person comments 5 times on one post | Only their first comment counts | Comment spam |
| Post owner replies in their own thread | Never counts | Self-farming |
| Commenter deletes their comment | No clawback | Small, and avoids griefing |
| Moderator hides a spam comment | The Reputation/Shards it gave the post owner are clawed back (ledger rows carry the comment id) | Same rule as posts |
| Milestone counting | Counts only *counted* likes, not the raw like count | Bot likes can't push milestones |
| Likes drop back under a milestone | Milestone kept, awarded once ever (key `milestone:{target}:{threshold}`) | Stable |
| Viral post hidden by a moderator | Clawback sums every ledger row attributed to that post (could be thousands); restore re-grants exactly | Same rule, bigger numbers; the audit log shows the amount |
| Like on a DRAFT / HIDDEN / DELETED post | Not possible to like (existing rules); nothing earned | — |
| Followers-only or other non-public post | Counts normally | Visibility isn't fraud |
| Liker is later BANNED | Job claws back every award that came from that liker's likes (ledger rows carry `actorId`) | Cheap first defence against bot rings |
| Moderator hides a post/comment | Claw back every Reputation and Shard award tied to it (likes + milestones), floor at 0 | Decided Q20 |
| Moderator restores it (appeal won) | Re-grant exactly what was clawed back (key `restore:{clawbackId}`) | Undo must be exact |
| Author deletes their own post | Keep earnings | The likes were real; deletion is not a moderation verdict |
| Clawback bigger than balance (already spent) | Balance goes to 0, shortfall recorded in the ledger row metadata, cosmetics kept | Decided "never below 0"; the fraud system can act on recorded shortfalls later |
| Daily check-in clicked twice / two tabs | Second call returns "already claimed". Key `checkin:{userId}:{yyyy-mm-dd}` | Idempotent |
| Suspended user | No check-in, no earning while SUSPENDED; their likes don't count for others | Status gates |
| Account deleted | Wallet, ledger, items deleted with the user | No orphan data |

### 4.6 Ranks

Lifetime Reputation never decays: it is what you earned. The **rank** is seasonal and needs activity, like a ranked game.

| Rank | Reputation earned in the last 90 days |
|---|---|
| Stargazer | < 100 (starting rank) |
| Meteor | 100 |
| Comet | 500 |
| Nova | 1,500 |
| Supernova | 4,000 |
| Galaxy | 10,000 |

Names are celestial on purpose: they must never sound like the item rarities (Dust … Prismatic).

- Shown on the profile and hover card next to lifetime Reputation (rank icon + name).
- Rolling 90-day window: inactive people slide down as old Reputation leaves the window; their lifetime number stays.
- Recomputed when Reputation is credited or clawed back, and by a nightly job for people whose old points just left the window.

| Case | What happens |
|---|---|
| Inactive for months | Rank drops step by step to Stargazer; lifetime Reputation unchanged |
| Clawback | Lowers the 90-day sum too, so the rank can drop immediately |
| One viral day | Can jump several ranks at once, then slides back if nothing follows (intended) |
| Brand-new account | Stargazer until 100 in 90 days |

Numbers are a first guess; tune them once real data exists.

### 4.7 Comment likes (prerequisite)
Comments have **no likes today** (only `PostLike`). The MVP adds `CommentLike` (same shape as `PostLike`), like/unlike endpoints, a `comment.liked` domain event, and the like button on comments.

### 4.8 How awards are computed (as built in Phase 1)
- Awards are computed **in the same database transaction** as the like or comment (`EconomyService.recordLike` / `recordComment`), not through Kafka: a like and what it earned commit together, and there is no consumer to fall behind.
- Moderation hide/restore (posts and comments) and ban/unban call the economy service inside their own transactions.
- Row locks are always taken in the same order (day rows by user id, then wallets), so concurrent likes queue instead of deadlocking; milestones are exact under concurrency (tested).
- Milestone Shards are **not** limited by the daily Shard cap: they are rare and paid once ever, and losing one to the cap would be permanent.
- The rank is kept in step on every award and take-back; a nightly job (03:00) recomputes it from the ledger as old Reputation leaves the 90-day window.

---

## 5. Gachahub+

### 5.1 Perks
- Animated avatar (GIF / animated WebP).
- 300 Prisms at the start of each 30-day period.
- ×1.5 Shards (section 4.3).
- Supporter badge next to the name (profile, hover card, post author, comments, chat thread header).
- Own banner picture (upload).
- Access to Prism cases (with the 18+ declaration, section 7.9).

### 5.2 Granting (MVP: admins only)
- Admin user page: **Grant 7 / 30 / 365 days**, **Revoke**. Both audit-logged with a reason.
- A grant extends from `max(now, premiumUntil)`, so stacking never loses time.
- `User.premiumUntil` is the single answer; one helper `isPremium(user, now)` is the only place the date is compared.
- Others only ever see `premium: true/false`, never the date.

### 5.3 Monthly Prisms
- Paid when a 30-day period **starts** while premium: at the grant, and every 30 days after while still premium. Key `prisms:{userId}:{periodStart}`.
- A 7-day grant pays 300 once. Fine while only admins grant; payments will map one paid month to one period.
- A job runs hourly to pay due periods; idempotent, so a missed run catches up.

### 5.4 When Gachahub+ ends

| Thing | After expiry |
|---|---|
| Items pulled with Prisms | Kept, still equippable |
| Animated avatar | Shown as its first frame (Cloudinary still-frame transform of the same upload). Renewing animates it again, no re-upload |
| Custom banner picture | Hidden; falls back to the equipped banner item, then the free preset |
| Supporter badge | Hidden |
| Shard multiplier | Off from that moment (next award) |
| Unspent Prisms | Kept, frozen: Prism cases show "Renew Gachahub+ to pull" |
| Prism spark points | Kept until the case closes, then converted as usual |
| Uploading a new animated avatar | Refused while not premium ("Animated avatars are a Gachahub+ perk"); a still upload works |

### 5.5 Gachahub+ edge cases

| Case | What happens |
|---|---|
| Revoked for abuse | `premiumUntil = now`; perks off as above; admin can also make a balance adjustment (audited) |
| Grant while already premium | Extends; no extra immediate Prisms (the next period pays) |
| Expires mid-pull request | Pull checks premium inside the transaction; a request after expiry is refused before charging |
| Expires on the same day as Shard earning | Credited-so-far stays; later awards use ×1 |
| Clock skew between servers | Only database `now()` is used for premium and day checks |

---

## 6. Cosmetics

### 6.1 Slots and where they show

| Slot | Shows on |
|---|---|
| **Frame** | Profile avatar, hover card, post author, comment author, chat thread header. *Not* inbox rows, notifications, mention lists (too small to read) |
| **Profile background** | Behind the profile page |
| **Mini background** | Behind the hover mini profile |
| **Banner** | Profile cover and hover card top |
| Text effect | Later |

### 6.2 Item kinds
- **Image item**: uploaded asset (PNG/WebP, animated WebP allowed for Radiant+). Frames are transparent PNG/WebP drawn over the avatar.
- **CSS item**: a preset id the frontend renders with CSS (gradients, rings, glows). The starter set is all CSS so pulls work before any art exists.
- Every item: slot, name, rarity, kind, asset or preset id, active flag.

### 6.3 Banner precedence
1. Custom banner picture (only while premium)
2. Equipped banner item
3. Free preset banner (`bannerPresetId`, today's six colours; still free for everyone, and their look can change)
4. Default

### 6.4 Rendering rules
- Text over any background or banner gets a scrim so it stays readable in light and dark themes.
- `prefers-reduced-motion`: animated avatars, frames and backgrounds show their first frame.
- Backgrounds lazy-load and have a solid fallback colour while loading.
- Frames never catch clicks (`pointer-events: none`) and scale with avatar size.
- Size limits: images ≤ 2 MB, animated ≤ 8 MB and ≤ 512 px for avatars; validated on upload, not just in the UI.

### 6.5 Owning and equipping
- One equipped item per slot. Equip only items you own (or free defaults). "Unequip" returns the slot to default.
- Edit Profile gets a **Cosmetics** tab: owned items by slot, rarity colour and stars, preview before equipping, equip is saved with the rest of Edit Profile's Save.

### 6.6 Cosmetic edge cases

| Case | What happens |
|---|---|
| Equip an item you don't own (crafted request) | 403 |
| Item taken down (offensive art) | Admin deactivates it; it renders as the slot default for everyone; owners get the item's duplicate refund as compensation (ledger reason `TAKEDOWN_REFUND`); audit-logged |
| Item edited after people own it | Asset can be replaced (fix a glitch); slot and rarity cannot change once anyone owns it |
| Viewer has blocked the profile owner | Cosmetics still render; block rules decide what else shows (existing behaviour) |
| Banned/deleted user's posts | Existing rules; no cosmetics rendered for DELETED |
| Very old browser without animated WebP | Falls back to the still frame |

---

## 7. Cases and pulls

### 7.1 Rarity

| Tier | Stars | Colour | Content |
|---|---|---|---|
| Dust | ★ | White | Small currency refund |
| Glint | ★★ | Green | Bigger currency refund |
| Glimmer | ★★★ | Light blue | Normal cosmetic |
| Radiant | ★★★★ | Purple | Better cosmetic |
| Prismatic | ★★★★★ | Gold-red | Featured chase item |

### 7.2 Default numbers (admin-editable per case before it opens)

| | Shard case | Prism case |
|---|---|---|
| Price ×1 / ×10 | 100 / 1,000 | 30 / 300 |
| Dust | 60%, refund 5–20 Shards (uniform) | 55%, refund 2–6 Prisms |
| Glint | 15%, refund 25–50 Shards (uniform) | 15%, refund 8–15 Prisms |
| Glimmer | 18% | 20% |
| Radiant | 6% | 8% |
| Prismatic | 1% | 2% |
| Radiant-or-better guaranteed within | 10 pulls | 10 pulls |
| Prismatic guaranteed by | pull 80 | pull 50 |
| Duplicate refund Glimmer / Radiant / Prismatic | 30 / 80 / 300 Shards | 9 / 24 / 90 Prisms |
| Spark cost | 120 points | 70 points |
| Spark leftover at close | 5 Shards per point | 2 Prisms per point |

Within a tier, each item has a weight (shown on the rates page).

### 7.3 Case types and schedule
- Per currency: one **Standard** case (permanent) and at most one **Featured** case live at a time (3 weeks).
- Admin schedules start/end dates; overlapping featured cases for the same currency are refused.

### 7.4 Pull algorithm (one pull)
1. Read pity counters for (user, currency).
2. If `pullsSincePrismatic + 1 ≥ hardPity` → Prismatic.
   Else if `pullsSinceRadiantPlus + 1 ≥ 10` → Radiant or Prismatic, using their relative base rates.
   Else roll the base rates.
3. Within the tier, pick an item by weight (`crypto.randomInt`, server only).
4. Dust or Glint → random refund in that tier's range. Item already owned (including earlier in the same ×10) → duplicate refund instead.
5. Update counters: Prismatic resets both; Radiant resets the Radiant counter; spark +1 for this case.
6. Write a `PullRecord`.

A ×10 runs ten of these in order inside **one** transaction.

### 7.5 Published rates
- Every case has a public rates page: base rate per tier, each item's chance, pity rules, spark cost, refunds.
- Also show the **effective rate including pity** (computed by simulation when the case is created, stored on the case), the number regulators and players actually care about.
- Rates are **frozen once a case opens**: no edits; to change, close it and open a new one.

### 7.6 Pull flow (request)
- `POST /cases/:id/pulls { count: 1 | 10, requestId }`.
- One DB transaction: lock the wallet row (`SELECT … FOR UPDATE`), check case open (DB time), premium and age for Prism cases, balance ≥ price, charge, run pulls, write records and ledger rows, commit.
- Response contains all results. **Results are saved before any animation**; the animation is only a show.

### 7.7 The capsule machine (frontend)
- A capsule drops and wobbles; its glow colour hints the rarity; it cracks open to the item. Prismatic gets a gold-red burst and a short screen flash.
- ×10 drops ten capsules in a grid: open one by one or "Open all"/"Skip".
- CSS animations only. Respects reduced motion (instant reveal). No roulette strip or slot visuals (stay away from casino-style mechanics, section 10).
- Afterwards: "Equip now" on new items.

### 7.8 Spark
- 1 point per pull in that case (×10 = 10 points). Points belong to the case.
- At the spark cost, "Pick any item" from that case's items you don't own. If you own them all, the button is disabled and points convert at close.
- When the case closes, a job converts leftover points (rates above), idempotent per (user, case).

### 7.9 History and 18+
- "Pull history" page: every pull with date, case, result, refund. Kept as long as the account exists.
- First Prism pull asks "I am 18 or older" (stored `ageConfirmedAt`). No Prism pull without it. Shard pulls open to everyone.

### 7.10 Pull edge cases

| Case | What happens |
|---|---|
| Double click / two tabs pull at once | Wallet row lock serialises them; same `requestId` returns the first result instead of pulling again |
| Network drops after the server committed | Client retries with the same `requestId` and gets the same result; history page also shows it |
| Tab closed mid-animation | Nothing lost; results already saved; shown in history and inventory |
| Not enough currency | Refused before any change; UI disables the button and shows what's missing |
| ×10 with enough for 9 | Refused; no partial ×10 |
| Case closes between page load and pull | Refused ("This case has ended"); nothing charged |
| Featured item's tier is all owned | Every pull of that tier becomes a duplicate refund (rates page says so) |
| Pity triggers on the same pull as a natural Prismatic | Counts once; both counters reset |
| Pity across cases | Counters are per currency and carry into the next case (Q30) |
| Prisms frozen (premium ended) | Prism cases refuse; Shard cases work |
| Prism pulls disabled by the Vietnam flag (section 10) | Prism cases are hidden; Prisms still accrue |
| Admin edits rates of an open case | Refused by the API |
| Admin adds/removes items in an open case | Refused; close and reopen |
| User banned mid-session | Session ends (existing); pending requests fail auth |
| RNG manipulation | Server-only `crypto.randomInt`; client never sends randomness; no client-side "pre-roll" |
| Balance cache out of sync with ledger | Nightly check sums the ledger per user and alerts on mismatch; the ledger wins |

---

## 8. Hover mini profile

- Hover (400 ms delay) on a name or avatar in posts, comments, chat and follow lists. On touch: tapping the avatar opens the card, which has a "View profile" button.
- Shows: banner, mini background, avatar with frame, name, @handle, supporter badge, rank, Reputation, follower count, Follow button (Edit Profile on your own card).
- Data: `GET /users/:id/card`, cached per user (React Query), so scrolling a thread doesn't fire a request storm.

| Case | What happens |
|---|---|
| Signed out | Card shows; Follow sends to login |
| You blocked them | Card shows "You blocked this person", no Follow |
| They blocked you | Same response as a missing user (existing "never leak the reverse" rule) |
| Deleted / banned account | "This account isn't available" |
| Card for yourself | Edit Profile instead of Follow |
| Many hovers quickly | Delay + cache + cancel on mouse leave |
| Keyboard users | Card opens on focus and closes on Escape; reachable with Tab |

---

## 9. Admin tools

- **Cosmetics**: create item (slot, name, rarity, kind, upload or CSS preset), preview, deactivate (takedown, 6.6).
- **Cases**: create, set rates/items/dates, view effective rates, open/close. Frozen when open.
- **Users**: Gachahub+ grant/revoke, wallet view (balances + recent ledger), balance adjustment with a required reason.
- Every admin action above is audit-logged (new `AuditAction` values).

| Case | What happens |
|---|---|
| Two admins edit the same draft case | Last write wins on drafts; opening locks it |
| Adjustment would go below 0 | Refused |
| Admin grants themselves premium | Allowed but audit-logged like any grant |

---

## 10. Compliance (Vietnam first)

What we found (not legal advice; **get a Vietnamese lawyer before launch**):
- Decree 147/2024/ND-CP (in force 25 Dec 2024) forbids trading virtual items between players and turning them into money, cards or vouchers. → No trading, gifting or cash-out (built in).
- Online gambling is banned for Vietnamese citizens, and casino-style mechanics in online games are reportedly prohibited. → Capsule reveal, no slot/roulette visuals; no currency or item has a money value outside the app.
- Paid random pulls may count as a licensed online game (G1). → **Prism pulls sit behind a config flag `PRISM_PULLS_ENABLED`** (default off in production until the lawyer answers). Shard pulls, which nobody pays for, stay on.
- Social networks must verify accounts by Vietnamese phone number before posting/commenting. → Separate launch blocker, not this plan.

Built-in safeguards: published rates and effective rates, pity and spark, pull history, 18+ declaration for Prism pulls, no trading, no cash-out, full ledger.

---

## 11. Data model (Prisma sketch)

```prisma
model User {
  // existing fields …
  premiumUntil   DateTime?
  ageConfirmedAt DateTime?
  bannerImageUrl       String?       // premium custom banner
  bannerMediaUploadId  String? @unique
}

model UserWallet {
  userId     String   @id
  reputation Int      @default(0)
  shards     Int      @default(0)
  prisms     Int      @default(0)
  updatedAt  DateTime @updatedAt
}

enum Currency { REPUTATION SHARDS PRISMS }

enum LedgerReason {
  DAILY_CHECKIN LIKE_RECEIVED LIKE_MILESTONE CLAWBACK RESTORE BAN_CLAWBACK
  PULL_COST DUST_REFUND DUPLICATE_REFUND SPARK_CONVERSION TAKEDOWN_REFUND
  PREMIUM_ALLOWANCE ADMIN_ADJUST
}

model LedgerEntry {
  id             String       @id @default(cuid())
  userId         String
  currency       Currency
  delta          Int
  balanceAfter   Int
  reason         LedgerReason
  sourceType     String?      // POST, COMMENT, PULL, CASE, GRANT …
  sourceId       String?
  actorId        String?      // the liker, the admin …
  idempotencyKey String       @unique
  metadata       Json?        // e.g. clawback shortfall
  createdAt      DateTime     @default(now())
  @@index([userId, createdAt])
  @@index([actorId])
  @@index([sourceType, sourceId])
}

model DailyEarning {
  userId        String
  day           DateTime @db.Date   // UTC+7 day
  baseShards    Int @default(0)
  creditedShards Int @default(0)
  likesCounted   Int @default(0)   // counted likes received today (for the steps)
  commentsCounted Int @default(0)
  repFromLikes   Int @default(0)   // credited so far today
  repFromComments Int @default(0)
  commentsWritten Int @default(0)  // for the 3 Shard-paying comments
  @@id([userId, day])
}

// Rank cache; the ledger stays the truth.
// UserWallet also gets: reputation90d Int, rank String, rankUpdatedAt DateTime

model LikerDailyReputation {   // per-liker cap: one liker → one author → one day
  authorId   String
  likerId    String
  day        DateTime @db.Date
  reputation Int @default(0)
  @@id([authorId, likerId, day])
}

model CommentLike { commentId String  userId String  createdAt DateTime @default(now())  @@id([commentId, userId]) }

enum CosmeticSlot { FRAME PROFILE_BACKGROUND MINI_BACKGROUND BANNER }
enum Rarity { DUST GLINT GLIMMER RADIANT PRISMATIC }

model CosmeticItem {
  id        String       @id @default(cuid())
  slot      CosmeticSlot
  name      String
  rarity    Rarity       // GLIMMER..PRISMATIC
  assetUrl  String?
  presetId  String?      // CSS item
  animated  Boolean      @default(false)
  active    Boolean      @default(true)
  createdAt DateTime     @default(now())
}

model UserCosmetic {
  userId     String
  itemId     String
  source     String   // PULL, SPARK, ADMIN
  acquiredAt DateTime @default(now())
  @@id([userId, itemId])
}

model EquippedCosmetic {
  userId String
  slot   CosmeticSlot
  itemId String
  @@id([userId, slot])
}

enum CaseKind { STANDARD FEATURED }

model CosmeticCase {
  id              String   @id @default(cuid())
  name            String
  currency        Currency // SHARDS or PRISMS
  kind            CaseKind
  startsAt        DateTime
  endsAt          DateTime?
  status          String   // DRAFT, OPEN, CLOSED
  price           Int
  ratesBp         Json     // basis points per tier
  refundRanges    Json     // { DUST: [min,max], GLINT: [min,max] }
  duplicateRefund Json
  radiantEvery    Int      @default(10)
  prismaticHardPity Int
  sparkCost       Int
  sparkConversion Int
  effectiveRates  Json?    // computed when opened
}

model CaseItem { caseId String  itemId String  weight Int  @@id([caseId, itemId]) }

model PityCounter {
  userId String  currency Currency
  sinceRadiantPlus Int @default(0)
  sincePrismatic   Int @default(0)
  @@id([userId, currency])
}

model SparkBalance { userId String  caseId String  points Int @default(0)  convertedAt DateTime?  @@id([userId, caseId]) }

model PullRequest { id String @id  userId String  caseId String  count Int  createdAt DateTime @default(now()) } // id = client requestId

model PullRecord {
  id         String  @id @default(cuid())
  requestId  String
  userId     String
  caseId     String
  index      Int
  rarity     Rarity
  itemId     String?
  duplicate  Boolean @default(false)
  refund     Int     @default(0)
  pity       Boolean @default(false)
  createdAt  DateTime @default(now())
  @@index([userId, createdAt])
}

model PremiumGrant {
  id          String   @id @default(cuid())
  userId      String
  grantedById String
  days        Int
  startsAt    DateTime
  endsAt      DateTime
  revokedAt   DateTime?
  reason      String?
  createdAt   DateTime @default(now())
}
```

Relations, cascades (`onDelete: Cascade` from User) and indexes get finalised in the migration. All migrations go to `chore/shared-migrations` first (team rule).

---

## 12. API

| Method | Path | Notes |
|---|---|---|
| GET | `/wallet` | Own balances, today's earned/cap, reset time |
| GET | `/wallet/ledger?cursor=` | Own history |
| POST | `/wallet/check-in` | Idempotent per day |
| POST/DELETE | `/comments/:id/like` | New |
| GET | `/cases` | Open cases for the viewer (Prism cases hidden when flag off) |
| GET | `/cases/:id` | Rates page data |
| POST | `/cases/:id/pulls` | `{ count, requestId }` |
| POST | `/cases/:id/spark` | `{ itemId }` |
| GET | `/pulls?cursor=` | Pull history |
| GET | `/cosmetics/me` | Owned + equipped |
| PUT | `/cosmetics/equipped` | `{ slot, itemId | null }` (sent by Edit Profile's Save) |
| POST | `/users/me/age-confirmation` | 18+ declaration |
| GET | `/users/:id/card` | Hover card |
| Admin | `/admin/cosmetics`, `/admin/cases`, `/admin/users/:id/premium`, `/admin/users/:id/wallet` | Audit-logged |

Public profile, post author, comment author and chat member payloads gain `premium: boolean`, `reputation` (profile/card only) and `equipped` (frame/banner/backgrounds as needed for that surface).

---

## 13. Backend modules
- `economy/`: wallet, ledger, earning consumer (likes), check-in, clawback/restore, ban clawback job, nightly ledger check.
- `cosmetics/`: items, inventory, equip, admin items.
- `cases/`: cases, pull engine, spark, conversion job, rates simulation, history.
- `premium/`: grants, `isPremium`, monthly Prisms job.
- Hooks into existing: `posts` (like events), `comments` (new likes + event), `content-moderation`/`posts/moderation`/`comments` moderation (clawback/restore), `users` (ban → clawback, card endpoint, avatar/banner upload rules), `audit-log` (new actions), `media` (BANNER purpose, animated avatar).

## 14. Frontend
- Wallet chip in the top bar (Shards, Prisms) → wallet page with check-in, ledger, "resets in".
- `/cases` page: case list, rates page, capsule machine, history.
- Edit Profile → Cosmetics tab.
- Profile page: background, banner precedence, frame, badge, Reputation stat (replaces a "coming soon" spot).
- `ProfileHoverCard` used by post/comment/chat/follow-list names and avatars.
- `/plus` page: perks list, "Upgrade – coming soon".
- Admin: Cosmetics, Cases, user premium/wallet panels.

---

## 15. Build phases

Each phase ships on its own and is hand-tested before the next.

**Phase 1 — Wallet and earning**
- `UserWallet`, `LedgerEntry`, `DailyEarning`, `CommentLike`; comment like UI.
- Economy consumer for post/comment likes, milestones, caps, hidden established rule.
- Daily check-in, wallet chip and page.
- Reputation and rank (90-day window, nightly job) on profile and in the ledger; clawback/restore on moderation; ban clawback job.
- Admin wallet view and adjustment.
- *Done when:* liking from an established account moves the author's balances once; caps hold; hide/restore round-trips exactly; tests for every row in 4.5.

**Phase 2 — Cosmetics and the hover card**
- Items, inventory, equip, admin item page, CSS starter set (≈ 6 frames, 6 backgrounds, 4 mini backgrounds, 4 banners across rarities).
- Rendering on every surface in 6.1, banner precedence, reduced motion, scrims.
- `ProfileHoverCard`.
- *Done when:* an admin-granted item can be equipped and is seen on every listed surface in both themes and on mobile.

**Phase 3 — Cases and pulls (Shards)**
- Cases, rates/effective rates, pull engine with pity, duplicates, spark, conversion job, history.
- Capsule machine.
- *Done when:* engine tests cover 7.10; a 100k-pull simulation matches the published rates; double-click and retry tests pass.

**Phase 4 — Gachahub+**
- Grants, `isPremium`, monthly Prisms job, multiplier, badge, animated avatar, custom banner picture, `/plus` page.
- Prism cases behind `PRISM_PULLS_ENABLED`, 18+ declaration.
- *Done when:* every row of 5.4 and 5.5 behaves as written.

**After the MVP:** payments (Stripe or MoMo/VNPay), Prism packs, text effects, suspicious-activity detection, Aura, Vietnamese phone verification (separate).

---

## 16. Testing
- Unit: pull engine (pity boundaries at 9/10 and 79/80, duplicates inside ×10, spark), multiplier rounding, established rule ranges, idempotency keys.
- Integration (local test DB `gachahub-test-postgres` on port 5434, never Neon): concurrent pulls, retries with the same `requestId`, clawback below 0, case closing during a pull.
- Simulation: effective-rate calculation, 100k pulls per case config.
- Frontend: Vitest for wallet, cosmetics tab, hover card states, capsule reveal with reduced motion.

## 17. Open items
- Exact UTC+7 day vs per-user time zone: revisit if many users are outside Vietnam.
- Lawyer answer on Prism pulls in Vietnam (blocks turning the flag on).
- Art pipeline for image items (who draws, sizes, review).
- Payment provider and Gachahub+ price.

## 18. Decision log
- 2026-10-29: Currencies are Reputation, Shards (free, earned only), Prisms (Gachahub+ only); Aura after MVP.
- 2026-10-29: Prism pulls allowed, subject to a lawyer's check before Vietnam launch (flagged off until then).
- 2026-10-29: Rarities Dust / Glint / Glimmer / Radiant / Prismatic with 1–5 stars; colours white, green, light blue, purple, gold-red. Dust and Glint are currency refunds (Glint bigger).
- 2026-10-29: Pity + spark; duplicates refund; standard + 3-week featured cases; numbers in 7.2 and 4.1.
- 2026-10-29: Established-account rule hidden and varied per account.
- 2026-10-29: No hard daily Reputation cap. Daily steps per author instead (likes 1:1 to 200, 1:10 to 1,000, then 1:100; comments 1:1 to 100, 1:5 to 500, then 1:20), max 5 Reputation per (liker, author) per day. Comments received earn Reputation (first comment per commenter per post). Liking/commenting never earns the actor Reputation; first 3 comments a day earn 1 Shard each. Shards keep the daily cap. (Supersedes the per-post 100 / big-milestone idea.)
- 2026-10-29: Seasonal ranks Stargazer → Meteor → Comet → Nova → Supernova → Galaxy from Reputation earned in the last 90 days; lifetime Reputation never decays.
- 2026-10-29: Free preset banners stay free; their look can change.
