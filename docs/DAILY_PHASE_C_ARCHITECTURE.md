# Fight Card Daily Phase C — Authoritative Daily Contract

Status: C0 architecture, C1 backend baseline, C2 assignment backend, and C3 client cutover are implemented. C4 leaderboard cutover remains.

Phase A created immutable Fight Card fixtures. Phase B made those fixtures playable. Phase C makes a Daily challenge globally identifiable and server-authoritative enough that two clients are not allowed to invent different definitions of "today."

This document records the V1 contract and its implementation status.

## 1. Problem

The current development flow still has three production gaps:

1. the client chooses its Daily fixture from the local fixture list;
2. the Daily date is derived from the device's local calendar;
3. leaderboard rows only pin a date and score.

That is acceptable for a development vertical slice. It is not sufficient for a shared global Daily.

A production Daily result must be able to identify:

- the authoritative UTC challenge date;
- the exact immutable fixture revision;
- the exact rules version;
- the gameplay seed used for deterministic board generation.

The browser must never be able to decide which fixture becomes the authoritative fixture for a date.

## 2. V1 decision

Use a **server-derived, persisted Supabase assignment**.

The browser may ask Supabase for today's assignment. If the row does not exist yet, a database function may create it, but the function itself chooses every authoritative field.

The client does **not** submit a fixture ID to create an assignment.

This avoids the rejected design:

> browser picks fixture → INSERT with UNIQUE(date) → whichever browser wins becomes truth.

Instead:

> browser calls "give me today's Daily" → database derives UTC date + active ruleset + fixture + seed → database inserts or returns the one assignment.

A race is harmless because every caller is asking the same server-side algorithm for the same result.

## 3. Authoritative assignment shape

Conceptual record:

    DailyAssignment {
      challengeDate: "YYYY-MM-DD"   // UTC
      fixtureId: "card-YYYY-NNN-rN" // immutable fixture revision
      rulesVersion: "fight-card-v1"
      seed: int32
    }

Implemented database table:

    private.daily_assignments
      challenge_date date primary key
      rules_version text not null
      fixture_id text not null
      seed integer not null
      created_at timestamptz not null default now()

The authority tables live in a non-exposed `private` schema. Clients cannot read or write them directly; the public RPC is the API boundary.

Once inserted, an assignment is immutable.

Do not update an old assignment when:

- a fixture correction creates a new revision;
- ratings change;
- the fixture pool changes;
- Draft rules change.

Historical identification depends on the stored row staying unchanged.

## 4. Versioned rulesets

The database needs an explicit, immutable description of which fixture revisions a rules version may assign.

Implemented normalized model:

    private.daily_rulesets
      rules_version text primary key
      active_from date not null unique
      rotation_salt bigint not null
      created_at timestamptz not null default now()

    private.daily_ruleset_fixtures
      rules_version text references daily_rulesets
      fixture_id text
      position smallint
      primary key (rules_version, fixture_id)
      unique (rules_version, position)

The active rules version is the newest `active_from` not later than the authoritative UTC date. A new version is activated by inserting a later `active_from`; the old ruleset does not need to be edited.

The normalized fixture table lets Postgres enforce that every persisted assignment's `(rules_version, fixture_id)` belongs to the published pool with a real foreign key.

The first published development ruleset is `fight-card-v1` with the three immutable Phase A development fixture revisions.

Rulesets are append-only in normal operation.

If gameplay semantics change in a way that could change the same date/fixture's board or score meaning, create a new rules version instead of editing the old one.

Examples that require a new rules version:

- changing attribute order semantics;
- changing physical eligibility;
- changing the late-weight algorithm;
- changing board size;
- changing seeded RNG consumption;
- changing a scoring rule used by the Daily leaderboard.

Pure visual changes do not require a new rules version.

## 5. Server assignment function

Recommended public RPC surface:

    get_today_daily_assignment()

The function should:

1. derive the date inside Postgres from UTC time;
2. return an existing assignment immediately when one exists;
3. select exactly one active ruleset for that date;
4. derive a fixture index from server-owned inputs only;
5. derive/store one int32 gameplay seed;
6. insert the assignment;
7. handle a concurrent insert by returning the already-created row;
8. return only the assignment fields the client needs.

Important properties:

- no client date parameter for the "today" endpoint;
- no client fixture parameter;
- no client rules-version parameter;
- no client seed parameter.

A separate admin/debug function can accept an explicit date if engineering needs it, but it must not be exposed as the normal anonymous production RPC.

## 6. Assignment selection algorithm

The exact rotation algorithm is intentionally less important than its invariants.

V1 requirements:

- deterministic for the same UTC date + ruleset;
- calculated only on the server;
- independent of caller/device;
- chooses only from the active ruleset's immutable fixture IDs;
- assignment is persisted after first resolution.

A server hash or deterministic rotation over:

    UTC date + rulesVersion + rotationSalt

is sufficient.

Because the resulting assignment is stored, future changes to the selection implementation cannot rewrite historical assignments.

## 7. Seed contract

Store the gameplay seed in the assignment instead of asking future clients to reconstruct it from an implicit hash algorithm.

C3 replaces the old date-derived input with:

    assignment.seed

The deterministic gameplay sequence remains:

1. assignment supplies fixture ID + seed;
2. client looks up the exact immutable fixture revision;
3. seeded RNG shuffles the 8 skills;
4. seeded RNG produces card boards;
5. seeded RNG resolves late weight;
6. seeded RNG produces Height/Reach boards.

The client must not consume seeded RNG before this sequence for presentation-only behavior.

## 8. Client failure behavior

Production Daily should **fail closed** when authority is unavailable.

If assignment retrieval fails:

- Classic still works;
- Blind still works;
- Challenge Codes still work;
- Career still works;
- Daily is shown as temporarily unavailable/offline;
- the browser does not invent a fixture and does not create a leaderboard-eligible local Daily.

This is a deliberate change from the current general "backend failure silently becomes local-only play" behavior. That fallback is safe for noncompetitive features; it is not truthful for a shared Daily whose identity depends on server authority.

A development-only fixture fallback may exist behind an explicit development flag, but it must never masquerade as the production Daily.

## 9. Stale-client behavior

If Supabase returns:

- an unknown fixture ID; or
- an unsupported rules version,

the client must not silently substitute a known fixture/ruleset.

Show a clear "Daily update required" or "Daily temporarily unavailable" state.

That protects immutable assignment identity from an old deployment guessing how to interpret new data.

## 10. UTC boundary

Daily date comes from the authoritative assignment.

Do not use the device's local `todayStr()` to decide:

- whether today's attempt is available;
- which leaderboard to load;
- which seed to use;
- which assignment is current.

Local storage may continue storing an ISO date string, but that string must be:

    assignment.challengeDate

The one-attempt policy then becomes one attempt per authoritative UTC Daily, not one attempt per device-local date.

## 11. Client orchestration

Do not make every Draft mode asynchronous.

Recommended flow:

    startDailyDraft()
      -> request assignment
      -> validate assignment
      -> resolve fixture by immutable ID
      -> mark authoritative challengeDate attempted
      -> initialize Daily RNG from assignment.seed
      -> start existing Phase B draft sequence

Classic/Blind/Challenge continue through the synchronous `startDraft` path.

The assignment metadata should remain attached to the finished Daily build/result:

    dailyMeta: {
      challengeDate,
      fixtureId,
      rulesVersion
    }

This is additive provenance and supports the roadmap's identification-level historical reproducibility target.

## 12. Leaderboard contract

Daily leaderboard rows must be partitionable by:

- challenge date;
- fixture ID;
- rules version.

Recommended shape added to the existing score concept:

    daily_scores
      date
      fixture_id
      rules_version
      score
      display_name
      created_at

New clients should not compare scores that only share a date while disagreeing on fixture/rules version.

### Submission

Prefer a database function over anonymous direct table INSERT:

    submit_daily_score(...)

The function should derive/verify the current assignment and reject a submission whose fixture/rules metadata does not match it.

At minimum validate:

- current authoritative UTC assignment;
- score is an integer in the allowed score range;
- fixture ID matches;
- rules version matches;
- display name length.

The browser should not be allowed to choose an arbitrary date for a "today" score.

## 13. Honest security boundary

This architecture improves **assignment integrity**, not full anti-cheat.

The current app has no authenticated player identity and computes gameplay/score client-side. A malicious caller can still fabricate a plausible score unless the server receives enough information to independently validate the run.

Therefore Phase C V1 should describe the leaderboard as casual/community competition, not cheat-proof competitive infrastructure.

Stronger integrity would require a later design such as:

- authenticated identity;
- server-verifiable pick/run payloads;
- signed run tokens;
- server-side score reconstruction.

Do not smuggle that larger project into Phase C.

## 14. Supabase security model

C2 uses a smaller API surface than public tables + RLS:

### Authority tables

`daily_rulesets`, `daily_ruleset_fixtures`, and `daily_assignments` live in the non-exposed `private` schema.

- `anon` and `authenticated` have no `USAGE` on the schema;
- they have no direct table privileges;
- RLS is enabled as defense in depth with no allow policies;
- assignment creation/read occurs only through the reviewed RPC.

The Supabase advisor reports "RLS enabled with no policy" as informational for these three tables. That is intentional: direct non-owner access should be denied.

### Public assignment RPC

`public.get_today_daily_assignment()` is intentionally callable by both `anon` and `authenticated`.

It is `SECURITY DEFINER` because callers must not receive direct authority-table privileges. The function:

- accepts **no arguments**;
- derives UTC date server-side;
- derives fixture/rules/seed only from server-owned rows;
- has a pinned empty `search_path`;
- schema-qualifies authority objects;
- uses no dynamic SQL;
- has `EXECUTE` revoked from `PUBLIC`;
- grants `EXECUTE` only to `anon`, `authenticated`, and `service_role`.

Supabase's advisor therefore reports the anonymous/authenticated `SECURITY DEFINER` execution as a warning. This is an explicit reviewed exception, not an accidental privilege leak: the function is the intended public Daily authority API and exposes only deterministic public challenge metadata.

### Future daily_scores

- use explicit grants and RLS if stored in an exposed schema, or prefer the same private-table + narrow-RPC pattern;
- no anonymous UPDATE or DELETE;
- score submission must validate the current assignment;
- leaderboard reads must partition by assignment identity.

## 15. Database source control

C1 completed the live audit before any CageLab DDL was added. The connected project had no application-owned public tables/functions and no migration history; in particular, the frontend's assumed `daily_scores` and `challenge_scores` tables did not exist.

The baseline is recorded in `docs/SUPABASE_BACKEND_BASELINE.md`.

C2 then established the first two production migrations, mirrored under `supabase/migrations/`, plus the authority contract checks under `supabase/tests/`.

From this point forward:

1. every permanent database change gets a migration;
2. deployed migrations are forward-only;
3. grants/security ship with the object they protect;
4. live schema and Supabase advisors are verified after DDL;
5. database contract checks live under `supabase/tests/`.

## 16. Rollout plan

### C0 — architecture

This document. No production behavior change.

### C1 — remote backend baseline — complete

- live project inspected after restore;
- no CageLab application schema or migration history existed;
- missing assumed score tables documented;
- repository database source-control boundary established.

### C2 — assignment backend — complete

- non-exposed ruleset/fixture/assignment schema created;
- authoritative UTC assignment RPC deployed;
- first `fight-card-v1` development ruleset seeded;
- assignment/fixture relationship enforced with foreign keys;
- database contract checks committed;
- live grants, RLS, function ACL/search path, and advisors verified.

### C3 — client cutover — implemented in PR #61

- every actual Daily start fetches a fresh server assignment;
- device-local date no longer defines attempt state, streak arithmetic, seed, fixture, or Daily leaderboard date;
- the assignment UTC date controls local attempt/completion records;
- the assignment fixture revision is resolved exactly; unknown fixtures fail closed;
- only supported `rulesVersion` values are accepted;
- gameplay RNG initializes from `assignment.seed`;
- `fight-card-v1` begins RNG consumption at skill-order shuffle — fixture selection consumes no client RNG;
- finished/saved builds carry identification-level `dailyMeta`;
- authority loading is cancellable and other Draft modes remain synchronous;
- modern Supabase publishable keys are sent as `apikey`, not treated as bearer JWTs;
- the obsolete client fixture selector is removed and the live C2 assignment is pinned as an exact deterministic regression case.

### C4 — leaderboard cutover

- add fixture/rules metadata to score records;
- move score submission behind validating RPC;
- filter/read leaderboard by authoritative assignment;
- decide how legacy rows remain visible.

## 17. Compatibility

Existing local saved builds and careers do not need migration merely because Phase C exists.

Old Daily leaderboard rows that lack fixture/rules metadata are legacy records. Do not retroactively guess their fixture/rules assignment unless historical data proves it.

Existing Challenge Codes remain separate and continue using their explicit shared seed.

## 18. Phase C completion criteria

Phase C is complete only when:

- UTC date is authoritative and device-independent;
- Daily fixture ID comes from server authority;
- rules version is explicit;
- gameplay seed is explicit;
- assignment rows are immutable;
- stale clients fail closed;
- leaderboard rows pin fixture/rules identity;
- backend schema/migrations/policies are reviewable from the repository;
- CI/database tests cover the new contract.

This still does not complete the broader Draft Strategy roadmap item. Build synergy, physical-profile tradeoffs, archetype relevance, and "highest number wins" remain separate product work.
