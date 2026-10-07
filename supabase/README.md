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

As of the C1 audit on 2026-10-07, the live project's `public` schema contains no CageLab application tables or functions and Supabase reports no application migration history.

The first migration created after this baseline will therefore establish CageLab's initial application backend rather than modify a legacy schema.
