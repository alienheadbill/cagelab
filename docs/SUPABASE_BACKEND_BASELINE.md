# Supabase Backend Baseline — 2026-10-07

Status: C1 baseline for Fight Card Daily Phase C.

This document records the live database state inspected through the connected Supabase project before CageLab introduces its first application-owned database schema.

Project reference:

`inceyzopygadykbllkza`

This is the same project referenced by the frontend's current Supabase URL.

## Executive finding

The live Supabase project's **public schema contains no CageLab application tables, views, or functions**.

There is also **no Supabase migration history** for application schema changes.

Specifically, the live audit found:

- no `public.daily_scores`;
- no `public.challenge_scores`;
- no `public.daily_assignments`;
- no `public.daily_rulesets`;
- no public application functions;
- no public table grants;
- no public RLS policies;
- no application migration records reported by the Supabase migration API.

The only database objects returned outside PostgreSQL system catalogs were Supabase-managed schemas such as `auth`, `extensions`, and `vault`.

Supabase's security and performance advisors reported no current findings, which is expected for an empty application schema.

## Consequence for the current frontend

`src/lib/supabase.js` currently assumes these REST resources exist:

- `/rest/v1/daily_scores`
- `/rest/v1/challenge_scores`

They do not exist in the audited project.

The frontend catches unsuccessful responses/network failures and falls back to local-only behavior, so the missing backend does not crash normal play. However:

- Daily score submission is not currently persistent/shared through this project.
- Challenge Code score submission is not currently persistent/shared through this project.
- Daily leaderboard reads do not currently have a real backing table here.
- Challenge leaderboard reads do not currently have a real backing table here.

This means Phase C is not a migration of an existing production leaderboard schema. It is the creation of CageLab's first auditable application-owned backend schema.

## Why this changes the implementation plan

The Phase C architecture originally included a defensive step to pull and preserve any existing `daily_scores` / `challenge_scores` schema and RLS before changing it.

The live audit proves there is no such schema in this project.

Therefore C2 can start from a clean migration history, with security and version control designed correctly from the beginning.

We must still preserve **frontend/local data compatibility**. The absence of remote tables does not mean localStorage Daily stats, Daily logs, saved builds, or Challenge behavior can be discarded.

## Baseline queries used

The audit used Supabase metadata APIs plus read-only catalog queries equivalent to:

    select
      n.nspname as schema_name,
      c.relname as object_name,
      c.relkind as object_kind,
      c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema','pg_toast')
      and c.relkind in ('r','p','v','m')
    order by n.nspname, c.relname;

and public-schema checks over:

- `information_schema.role_table_grants`;
- `pg_proc` + `pg_namespace`;
- `pg_policies`.

The public-schema result set was empty.

No DDL was executed during this baseline audit.

## Current project lifecycle note

The Supabase project was inactive when the audit began. It was restored so the database could be inspected.

After restoration, SQL/catalog queries became available. The control-plane project status may transiently continue to report `COMING_UP` while services finish warming; database responses are the evidence used for this baseline.

## C2 starting point

The first CageLab database migration should create a minimal backend surface with explicit grants/RLS from day one.

Planned objects:

### Internal authority data

- Daily rulesets / published fixture-pool configuration.
- Immutable Daily assignments.

These should not be directly writable by anonymous clients.

### Public API functions

- Retrieve today's authoritative Daily assignment.
- Submit a Daily score only when assignment metadata matches.
- Read the leaderboard for the authoritative assignment.

Function execution grants must be explicit.

### Challenge leaderboard

Challenge Code persistence should be established deliberately rather than preserving the current fictional table assumption. It may remain a simpler table/RPC than Daily because it does not require UTC assignment authority.

## Security baseline

Because there is no application schema, there is no legacy security policy to preserve.

C2 must therefore enforce these rules explicitly:

- RLS enabled on every exposed application table.
- No accidental anonymous table writes through default privileges.
- Minimum GRANTs only.
- No anonymous UPDATE or DELETE for score history.
- Privileged functions reviewed carefully.
- Function `EXECUTE` revoked from `PUBLIC` and granted only to intended API roles.
- Any `SECURITY DEFINER` function must pin/schema-qualify its search path and expose only the smallest necessary operation.
- Run Supabase security advisors after applying DDL.

## Source-control policy from this point forward

All CageLab-owned database DDL must be represented in the repository.

The `supabase/` directory is the database source-control boundary.

Rules:

1. Every production schema change gets a named migration.
2. Migrations are forward-only once deployed.
3. RLS policies and grants ship in the same reviewed change as the table/function they protect.
4. Database functions are treated as application API code and reviewed accordingly.
5. Live-console-only schema edits are not an acceptable long-term workflow.
6. After DDL, verify the live schema and run security/performance advisors.

## C1 conclusion

**C1 is complete.**

There is no application-owned Supabase schema to import.

C2 can establish the first authoritative CageLab backend schema from a clean baseline.
