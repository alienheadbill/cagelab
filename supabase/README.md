# CageLab Supabase

This directory owns CageLab's database schema history.

The connected production project is documented in `docs/SUPABASE_BACKEND_BASELINE.md`.

## Repository contract

- `migrations/` contains forward database migrations once CageLab begins owning application schema.
- Database tables, grants, RLS policies, functions, and indexes are reviewed as code.
- Do not make permanent production-only schema changes that are absent from this repository.
- Do not expose new `public` tables to anonymous/authenticated clients without explicit grants **and** RLS.
- Do not rely on the frontend's publishable key as a security boundary.
- Keep service-role/secret keys out of the client and repository.

## Current state

C1 established that the project had no pre-existing CageLab application schema.

C2 then deployed and recorded:

- `20261007193201_create_daily_authority_v1.sql`
- `20261007193341_index_daily_assignment_ruleset_fixture.sql`

Authority state lives under the non-exposed `private` schema. The intentionally public API surface is `public.get_today_daily_assignment()`, which accepts no client authority fields.

Database contract checks live under `supabase/tests/`.
