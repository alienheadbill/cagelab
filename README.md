# CageLab

CageLab is an MMA draft and career/universe simulator. Players draft a fighter from real-fighter-derived attribute data, then can take that build into a persistent fictional career world with rankings, titles, events, history, and long-term progression.

The product is intentionally split between two layers:

- Draft builds the fighter: Classic, Blind, Challenge, and the in-progress Fight Card Daily experience.
- Career/Universe tests that fighter over time inside a persistent simulated world.

## Development

Requirements:

- Node.js 22
- npm

Commands:

    npm ci
    npm run dev
    npm run lint
    npm test
    npm run build

Before a pull request is considered ready, lint, tests, and build should all complete successfully. GitHub CI runs the same verification on pull requests and on pushes to main.

## Project map

- src/App.jsx — top-level application state and screen orchestration.
- src/components/ — presentation and screen-level React components.
- src/data/ — attributes, fighter data, and immutable Fight Card fixtures.
- src/lib/career.js — career and universe simulation engine.
- src/lib/scoring.js — GOAT Score, Build Value, matchup analysis, and scoring helpers.
- src/lib/rng.js — deterministic random-number and seed utilities.
- src/lib/storage.js — browser persistence/export/import.
- src/lib/supabase.js — leaderboard REST integration.
- CAGELAB_ROADMAP.md — product roadmap and locked design decisions.

For architecture boundaries and known debt, read docs/ARCHITECTURE.md.

## How work gets done

CageLab uses a lightweight owner + engineering-team workflow. Product ideas are captured first, triaged for feasibility and product value, converted into a scoped issue with acceptance criteria, implemented on a branch, verified in CI, reviewed by a second engineer, and then merged.

Read docs/ENGINEERING_WORKFLOW.md before starting meaningful feature work.

## Current engineering principles

- Do not push feature work directly to main.
- Keep pull requests focused; do not hide unrelated refactors inside feature work.
- Preserve deterministic behavior in seeded modes.
- Preserve existing saves unless a migration is explicitly designed.
- Treat scoring, combat simulation, persistence, and Daily fairness as compatibility-sensitive systems.
- Prefer extracting new pure logic into focused modules instead of continuing to grow App.jsx.
- A test claim should be reproducible from the repository, not only described in a PR body.

## Product direction

The detailed roadmap lives in CAGELAB_ROADMAP.md. The current product direction emphasizes deeper Draft strategy and Fight Card Daily before finalizing Draft/Career evaluation, then continues into richer universe history and move-by-move fight presentation.

The code on main is the source of truth for shipped behavior. Issues and pull requests are the source of truth for active work.
