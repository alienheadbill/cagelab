# CageLab Architecture

This is a practical map of the current application, its compatibility-sensitive boundaries, and the direction for incremental cleanup.

## Runtime shape

CageLab is a client-side React application built with Vite.

The major layers are:

### Application orchestration

src/App.jsx owns a large amount of top-level state and coordinates Draft, saved builds, Career setup, navigation, Daily/Challenge modes, persistence calls, and screen transitions.

This is currently a known concentration point, not a pattern to copy for new systems.

Rule: new domain behavior should be extracted into focused pure modules when possible. App.jsx should increasingly orchestrate systems rather than contain their algorithms.

### Components

src/components contains React presentation and screen components.

Components may format and display derived values, but gameplay decisions should not depend on component-local animation state or presentation-only randomness.

### Data

src/data/attrs.js
- attribute definitions;
- supported weight classes;
- physical baselines.

src/data/fighters.js
- master fighter/appearance pool;
- draft-board helpers for the existing roster.

src/data/fightCards.js
- immutable, revisioned Fight Card fixtures;
- fixture validation and lookup helpers;
- currently development fixtures only.

A published Fight Card fixture revision is treated as an immutable artifact. Corrections should create a new revision instead of silently changing the old one.

### Deterministic utilities

src/lib/rng.js owns seeded RNG and challenge-code helpers.

For seeded gameplay, the number and order of RNG calls is part of the behavior contract. Adding an apparently harmless random draw can change every later board for the same seed.

### Scoring and evaluation

src/lib/scoring.js contains Draft-facing evaluation such as:
- GOAT Score;
- Build Value;
- physical normalization;
- build qualities/archetype analysis;
- matchup analysis.

These concepts are intentionally distinct. A complete/balanced build, a dangerous combat build, and a successful career are not the same measurement.

### Career and universe

src/lib/career.js is the main career simulation/domain engine.

It currently contains a very large amount of behavior in one module. This is technical debt, but a full rewrite would be high-risk.

Refactor policy:
- extract by stable domain boundary;
- keep behavior identical during structural extraction;
- add deterministic tests before changing simulation rules;
- avoid mixing architecture cleanup with balance changes.

Candidate future extraction boundaries include matchmaking, rankings, title state, fight simulation, camps/development, NPC world movement, and legacy evaluation.

### Persistence

src/lib/storage.js owns localStorage keys and import/export mechanics.

Persistence-sensitive data includes:
- saved builds;
- active career;
- career history;
- Daily stats/log;
- preferences/settings.

Compatibility rule: old data should continue to load unless a versioned migration explicitly says otherwise.

### Backend

src/lib/supabase.js currently talks to leaderboard REST endpoints directly from the browser.

The publishable client key is not a secret. Security and integrity depend on the backend's Row Level Security/policies and any server-side validation.

Repository limitation: database migrations and RLS policies are not currently checked into this repository, so those guarantees cannot be audited here. Future backend work should make server-side schema/policy changes reviewable alongside application changes.

## Known structural debt

The largest files are currently approximately:
- src/lib/career.js — 300+ KB;
- src/App.jsx — 170+ KB;
- src/styles.css — 100+ KB.

This is not a reason for a rewrite.

The rule is incremental containment:
1. stop adding unrelated algorithms to the monoliths;
2. extract pure logic when touching a stable boundary;
3. lock behavior with tests;
4. refactor only when it reduces risk for an actual upcoming feature.

## Data authoring references

Historical one-off source snapshots that are useful for provenance live under `data/source/`. They are not runtime modules and must not be treated as current gameplay truth.

In particular, the former root `roater` file now lives there as a documented roster-authoring snapshot. The application must continue to read fighter data from `src/data/fighters.js`.

## Sources of truth

Use the following hierarchy:

1. main branch code — shipped behavior.
2. merged PRs — history of why behavior changed.
3. open issues/PRs — active work and accepted scope.
4. CAGELAB_ROADMAP.md — product direction and locked/deferred design decisions.
5. chat discussions — useful discovery context, but not the final engineering record.

When these disagree, resolve the disagreement in GitHub rather than relying on memory.

## High-risk invariants

### Determinism
Same supported seed and same versioned rules should produce the same gameplay decisions in seeded modes.

### Save compatibility
A UI refactor must not invalidate stored builds/careers.

### One source of truth
Do not let a visual component, restored screen state, and saved record each independently decide values such as division, title holder, score, or fixture assignment.

### Explainable mechanics
Displayed explanations should match the actual formulas. Do not present decorative numbers or badges as mechanics if they do not affect simulation.

### Product truthfulness
Development/synthetic data should not be presented as historical fact. Simulation claims should not imply realism that the engine does not model.

## Testing direction

The repository now starts with Node's built-in test runner for pure deterministic modules.

Preferred testing pyramid:
- many fast unit/contract tests for rng, scoring, fixture validation, and career domain functions;
- targeted integration tests for state/persistence boundaries;
- a small browser suite for critical end-to-end flows and responsive regressions.

Do not begin by snapshot-testing huge React trees. Protect rules and state transitions first.

## Near-term engineering priorities

1. Establish CI and reproducible baseline tests.
2. Continue Fight Card Daily in focused phases without mixing in unrelated Draft Strategy mechanics.
3. Fix known persistence/source-of-truth bugs as small PRs.
4. Make Daily assignment/rules authority explicit before treating leaderboards as strongly competitive.
5. Add regression coverage before modifying career simulation or evaluation formulas.
6. Extract architecture only where upcoming work benefits from the extraction.
