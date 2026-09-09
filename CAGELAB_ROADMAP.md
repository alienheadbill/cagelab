# CageLab Development Roadmap

_Last updated: 2026-09-08_

> **Update log (2026-09-08, post-upload):** Two sections below were corrected
> against actual repo state before this doc was committed:
> - **Persistent MMA Universe Foundation V1 (PR #35)** was listed as open —
>   it is now **merged** into `main` (`e12d70e`). Moved to Section 1.
> - **Active Career Save + Resume V1** was listed as 🔜 Next — it is now
>   **implemented, tested, and pushed** to branch `career-active-save-v1`
>   (`071d3b3`). No PR opened yet. Moved to Section 2 as current work.
>
> Keep this doc in sync going forward: when a roadmap item's real status
> changes (branch pushed, PR opened, PR merged), update its entry here in
> the same pass rather than leaving it to drift.
>
> **Update log (2026-09-08, later same day):** Active Career Save + Resume
> V1 (PR #37), NPC World Movement + Bout Ledger V1 (PR #38, including its
> own pre-PR realism/archive hardening pass), and Universe Events V1
> (PR #39) all merged into `main`. Event Archive + Fighter Histories V1 is
> now implemented, tested, and pushed to
> `career-event-archive-fighter-histories-v1` — no PR opened yet.
>
> **Update log (2026-09-09):** Event Archive + Fighter Histories V1 merged
> (PR #40). New Career/Universe feature work is intentionally paused for a
> focused presentation pass: **Visual Design Audit + CageLab Design System
> V2** (branch `visual-design-system-v2`, implemented and pushed, no PR
> opened yet). Title Lineage, Universe News, and Rankings History all move
> one slot later in Section 10's priority order to make room for it.
>
> **Update log (2026-09-09, direction correction):** PR #41 (Design System
> V2) opened, then corrected after live-preview review: the green
> win/positive semantic and white primary buttons moved too far from
> CageLab's identity. Gold/brass is restored as the one brand + success
> color; buttons are dark/graphite with a gold edge instead of white; a
> faint cage-mesh + vignette background atmosphere was added; the draft
> screen's false-clickable attribute grid was replaced with a read-only
> Scouting Summary plus the (previously built but unused) `FighterSilhouette`
> component, now also reused on the Stats tab. The neutral dark
> canvas/surface readability win from the first pass is kept. PR #41
> updated in place, still not merged.

## Product North Star

CageLab should evolve from a fighter-construction game with a Career Mode into a **persistent MMA universe simulator where the player controls one fighter inside an evolving world**.

The Career experience should feel like living through an MMA career rather than watching hidden state change. Opponents should have believable identities, rankings should feel earned, major events should surface when they happen, and the world should continue developing beyond the player.

---

## Status Legend

- ✅ **Merged / complete**
- 🟡 **Open / in review**
- 🔜 **Next**
- ⏳ **Planned**
- 🧪 **Research / audit required**
- 🧊 **Frozen unless a dedicated pass reopens it**

---

# 1. Completed Career Foundations

## ✅ Career Simulation Engine

Core Career loop is implemented, including:

- Career creation from a CageLab fighter build
- Fictional Career opponents
- Round-by-round fight simulation
- Fight stats, scorecards, finishes, damage and fatigue
- Career aging and wear
- Contracts and purse progression
- Camp planning
- Rivalries
- Legacy / Hall of Fame outcomes
- Retirement
- Career History

### Stability rule

Core combat and progression systems should not be casually changed during unrelated feature work.

---

## ✅ Rankings + Championship Structure

Implemented:

- Champion identity
- Top 15 rankings
- #1 contender state
- Tier-aware rankings
- National and Premier title logic
- Title wins / defenses
- Title prestige presentation

Current rank labels:

- #1 Contender
- Top 5
- Top 10
- Top 15
- Unranked
- Champion is tracked separately

---

## ✅ Career Presentation Recovery

Major Career events now surface live instead of relying on Career History as the primary discovery surface.

Implemented presentation includes:

- Fight Result spotlight
- Promotion milestones
- Title-win milestones
- Retirement cleanup
- Mic Time
- Show Respect
- Contextual callouts
- Pre-fight Scouting
- Fight Notes
- Gameplan ↔ Scouting truth

### Product rule

**Career History is the historical record, not the primary place where the player discovers important events.**

---

## ✅ Matchmaking Realism V1 — PR #32

Goal: make Career matchmaking behave more like real professional MMA matchmaking.

Implemented:

- Contextual opportunity labels
- Stay Busy
- Prospect Test
- Earn Your Ranking
- Climb the Ladder
- Defend Your Rank
- Main Event Opportunity
- Title Eliminator
- Step-Up momentum gating
- Opponent-rank-aware loss consequences
- Deliberate ranked-test escalation
- Loss de-escalation
- Lower-tier title-path improvements
- Regional/National progression pacing cleanup

Key design rule:

**The Career system decides what level of opportunity is earned; RNG chooses an appropriate opponent from the valid pool.**

---

## ✅ Duplicate Timeline ID Hotfix — PR #33

Fixed duplicate IDs for repeated:

- Training Events
- Media Events
- Off-Cycle Events

Added a deterministic `timelineEventSeq` without abusing `fightGlobalIndex`.

---

## ✅ Career Roster Ecology + Division Depth V1 — PR #34

The unranked pool no longer means “weak filler.”

### Final persistent roster sizes

| Circuit | Champion | Ranked | Unranked | Total |
|---|---:|---:|---:|---:|
| Regional | 1 | 15 | 24 | 40 |
| National | 1 | 15 | 32 | 48 |
| Premier | 1 | 15 | 40 | 56 |

### Unranked ecology

- **Ranking Bubble**
- **Hot Prospect**
- **Veteran Gatekeeper**
- **Solid Unranked**
- **Developmental**

This enables believable fighters such as:

- 7-0 prospects
- 9-1 prospects
- 15-6 ranking-bubble contenders
- 18-9 gatekeepers
- dangerous specialists outside the Top 15
- developmental opponents appropriate for rebuilding or early progression

### Matchmaking integration

The richer ecology feeds the existing Matchmaking Realism system instead of replacing it.

Low-risk fights deliberately avoid accidentally drawing elite unranked prospects, protecting LOW / AVERAGE Career viability.

---

## ✅ Persistent MMA Universe Foundation V1 — PR #35

**Status: merged into `main`** (`e12d70e4a485309deac0872448e40e91aa85d5b5`).

This is the architectural transition from one disposable division to a persistent world.

### Foundation behavior

Regional, National and Premier now exist simultaneously inside a Career save.

- Regional: 40 fighters
- National: 48 fighters
- Premier: 56 fighters

The player only actively participates in one circuit at a time, but the other circuits already exist before the player arrives.

### Major architecture

- `state.universe`
- persistent Regional / National / Premier divisions
- global monotonic NPC fighter IDs
- isolated serializable universe RNG state
- authoritative universe roster storage
- active-roster normalization after rehydration
- tier promotion switches into an existing world instead of generating a new one

### Important bug fixes included

- New circuit entry now starts **UNRANKED**
- Regional success can earn a ranked opportunity, but not a transferred ranking
- Contender Series no longer risks syncing National state into Regional
- fighter IDs continue without reuse across weight-class rebuilds

### Current Phase 1 limitation

Inactive divisions are intentionally static.

They exist, but they do not yet generate background fights or ranking movement.

---

# 2. Current Work

## ✅ Active Career Save + Resume V1 — PR #37

### Goal

Closing or refreshing CageLab should no longer destroy an active Career.

The player should return later and continue the same:

- fighter
- Career state
- universe
- rankings
- pending decision
- contracts
- milestones
- Camp state
- rivals
- title state
- universe RNG state
- fighter IDs

### What shipped

- One local active-Career slot (`LS_ACTIVE_CAREER`), autosave to
  localStorage on every authoritative/resume-critical state change
- Resume through the existing **Continue Career** Home behavior —
  zero HomeScreen.jsx changes needed
- Canonical serialization: `divisionRoster` (the live-memory alias) is
  never redundantly written alongside `universe.divisions`; reconstructed
  on load via `normalizeUniverseState` — the first real runtime consumer
  of that Foundation V1 rehydration path
- Save-envelope versioning (`ACTIVE_CAREER_SAVE_VERSION`, independent of
  `universe.schemaVersion`)
- Corrupt-save safety — malformed/wrong-shape/unrecognized-version saves
  are rejected, never partially hydrated, never crash the app
- Completed Career clears the active save (no resurrecting a finished run)
- Export/import compatibility (`activeCareer` field, backward-compatible
  with pre-existing exports)
- Validated with a Node harness against real `career.js` (drift, RNG/
  fighterSeq/timelineEventSeq continuity, size/performance) **and** a real
  headless-browser pass (Playwright) confirming Fight Result / Mic Time /
  Camp Complete / weight-move-offer resume all work correctly at 390px and
  1280px — this caught and fixed one real bug (a pre-existing effect that
  would have silently reset a resumed Mic Time step) before it shipped

### Explicit non-goals (unchanged)

- No cloud sync
- No multiple save slots yet
- No NPC world movement yet
- No event cards yet

---

# 3. Near-Term Roadmap

## ✅ NPC World Movement + Bout Ledger V1 — PR #38

**Shipped** (`career-npc-world-bout-ledger-v1`, PR #38, merged), including a
pre-PR realism/archive hardening pass on the same branch. Regional/
National/Premier now advance one world tick per committed player fight,
every meaningful NPC record/form/ranking/title change is backed by a real
persisted bout, and a versioned compact archive keeps completed-Career
storage safe at scale. Actual shipped schema, cadence, and rematch-cooldown
details are documented in `universe.bouts`/`WORLD_TICK_CADENCE`/
`REMATCH_COOLDOWN_TICKS` in `career.js` rather than duplicated here.

---

## ✅ Universe Events V1 — PR #39

**Shipped** (`career-universe-events-v1`, PR #39, merged). Bouts World
Movement already resolves are grouped into persistent CLF event cards
(`universe.events`, `eventNumbers` independently monotonic per circuit,
deterministic permanent card order) without resimulating anything. Also
fixed a real weight-class-move bug found during that pass (a move used to
discard all prior universe history) and added `titleTransitions` for
non-fight belt vacancies (promotion/Contender Series/weight move/
retirement). No Event Archive/Fighter History UI yet — that's this next
section.

---

## ✅ Event Archive + Fighter Histories V1 — PR #40

**Shipped** (`career-event-archive-fighter-histories-v1`, PR #40, merged).

### Goal

Make accumulated universe history browsable.

### What shipped

- Read-only presentation layer (`src/lib/universeHistory.js`) over the
  canonical bout ledger / universe events / completed-Career archive —
  never resimulates a fight, never mutates universe/rankings/active save
- **Event Archive**: browse Regional/National/Premier/Contender Series
  cards (newest first, circuit filter), open one to see the real
  historical card in permanent order — main event / co-main / featured /
  full card, fight-night rank and record snapshots, title context, tapped
  fighter names open their own history
- **Fighter History**: tracked record, tracked CLF fight count (never
  overclaimed as a fighter's whole career — generated fighters begin with
  a synthetic pre-tracking record), peak observed rank, full event-linked
  fight list with fighter-to-fighter navigation
- Works uniformly across all four historical data shapes: an active
  Career's live universe, a migrated pre-Events-V1 active save, a
  completed Career's compact archive V2, and an older completed archive
  V1 (synthetic event grouping honestly labeled as reconstructed)
- Reached from the existing Stats tab (active Career) and My Legacy's
  Career Archive detail (completed Careers) — no new bottom-nav tab

### Explicit non-goals (this pass)

- No Title Lineage presentation page yet (a pre-existing, unrelated live
  roster `isChampion` staleness edge case around same-fight promotions
  remains a watch item for that later pass)
- No Universe News
- No Rankings History (week/year-by-year) page

### Source-of-truth rule

No independent duplicate fighter-history arrays — everything here is
derived from the bout ledger, universe events, and title transitions
already persisted by the two phases above.

---

## 🟡 Visual Design Audit + CageLab Design System V2 — PR #41 (open)

**Status: implemented and pushed** to branch `visual-design-system-v2`,
open as **PR #41**, not yet merged.

### Goal

External playtest feedback consistently praised the game systems/content
but flagged the presentation: the color scheme and font treatment "throw
people off," and readability should improve. This pass addresses that
before adding more text-heavy systems (Title Lineage, Universe News,
Rankings History) on top of a presentation layer that isn't landing.

**Not a gameplay redesign.** No mechanics, combat, matchmaking logic,
rankings, World Movement, event creation, Fighter History, Career
progression, Legacy, Camp, or title logic changed. `src/lib/career.js` is
untouched (byte-identical to the merged-main copy).

### Direction correction (post-preview review)

The first PR #41 preview leaned too far toward a generic light/green
dashboard (white primary buttons, green win states). Reviewing the live
preview, that direction was corrected back toward CageLab's own identity
**without discarding the genuine readability win**:

**CageLab — UFC-inspired fight broadcast × CageLab gold.** Neutral dark
canvas/surfaces stay (the real fix for the old muddy brown foundation),
but CageLab brass/gold is restored as the ONE brand + success color —
wins, positive progression, and premium moments are gold again, not
green. Red stays reserved for loss/danger/Step-Up. Routine buttons are a
dark/graphite surface with a gold edge + gold label, not a flat white
block. A faint CSS-only cage/chain-link crosshatch plus a soft vignette
give the background more arena atmosphere (no image asset).

### What shipped

- **Neutral dark foundation** (kept from the first pass): canvas/surfaces/
  borders moved off the old brown/sepia family onto near-black/charcoal/
  graphite (`--canvas`, `--bone`, `--card-bg`, `--surface-2`).
- **Gold restored as CageLab's one brand/success color**: wins, favorable
  matchups, positive progression, event-card winner treatment, and Fight
  Result WIN all render in brass again, not green — the `--positive`
  green token introduced in the first pass was removed entirely. Gold
  still gets stronger treatment (full solid fill via `.btn-championship`,
  hero glow) at genuinely premium/championship moments, so there's still
  real distance between "routine gold accent" and "hero moment" — the
  distinction comes from hierarchy and context, not a second brand hue.
  Matchmaking's Easy tag is now a quiet neutral (not green, not
  gold-competing-with-Ranked); Ranked keeps gold; Step-Up stays red.
- **Shared tint tokens** (kept): every rgba() border/background wash in
  `styles.css` draws from `--line-rgb` / `--brass-rgb` / `--blood-rgb`
  instead of scattered literal hex/rgb values.
- **Button system, reworked**: `.btn-primary` is now a dark/graphite
  surface with a gold border and gold label (not a white/neutral solid,
  not a full gold fill) — obvious as "the action to take" without
  spending the brand's full-strength fill on every ordinary CTA.
  `.btn-championship` (full gold fill) is reserved for the title-win/
  title-defense milestone CTAs; `.btn-danger` (red) is unchanged.
- **Surface-over-border** (kept): interactive rows distinguished from
  their parent panel by the raised surface token with a lighter,
  structural border rather than a strong border alone.
- **Cage atmosphere**: a very low-opacity CSS crosshatch (chain-link/
  cage-mesh suggestion) plus a soft edge vignette sit behind every screen
  — pure gradients, no image, tuned to stay present-if-you-look-for-it
  and never compete with text.
- **Draft screen — false-affordance fix + fighter silhouette**: the old
  boxed attribute grid (looked like a second, clickable menu next to the
  real draft board) is replaced with a plain-text, read-only Scouting
  Summary (best-so-far/weak-spot, gold/red respectively) plus the
  existing `FighterSilhouette` component — previously built but unused in
  practice — now shown progressively filling gold as the draft completes
  (fill reflects overall completion, not a fabricated attribute-to-body
  mapping). A "Draft Board / Choose 1 fighter this round" heading and a
  gold accent bar make the actual candidate cards the clear primary
  surface, with a new desktop hover state on each card. The same
  silhouette (fully filled) now also appears on the Stats tab as a small
  visual anchor for the finished build.
- Typography (Anton condensed display / Work Sans UI sans / IBM Plex Mono
  tabular) unchanged — already the right three-role system.

### Explicit non-goals (this pass)

- No Title Lineage, Universe News, or Rankings History UI
- No fighter portraits, faces, or generated fighter art
- No bottom-nav changes (still Career / Rankings / Stats / Camp)
- A full bespoke reference-mockup rebuild of every screen in the original
  brief was explicitly out of scope for a systemic token pass — see the
  PR's own "known limitations" for what remains available as follow-up
  polish once this corrected foundation is reviewed.

---

## ⏳ Universe News + Historical Presentation

### Goal

Turn stored universe facts into storytelling.

Potential presentation:

- **NEW CHAMPION**
- **PROSPECT WATCH**
- **TITLE ELIMINATOR SET**
- **FORMER TOP-10 VETERAN**
- **FOUR-FIGHT WIN STREAK**
- **CHAMPION MAKES THIRD DEFENSE**

### Planned historical systems

- Championship lineage
- Multiple title reigns
- Defense history
- Peak rank
- Former Top 5 / former Top 10 context
- Historical rankings snapshots where useful
- Factual Career news derived from actual universe events

### Product payoff

A player reaching Premier should recognize fighters whose careers they have watched develop while climbing Regional and National.

---

# 4. Combat Simulation / Fight Presentation Roadmap

## ⏳ Move-by-Move Spectator Fight Simulation

Long-term fight presentation should move toward a **watch-the-fight-unfold** model inspired by move-by-move browser wrestling simulations.

The player does **not** manually choose individual moves during a fight.

The player prepares through systems such as:

- fighter build
- Camp
- Scouting
- Gameplan
- matchup selection

Then the fight simulation plays out as a spectator experience.

### Planned presentation

Fight state may include conditions such as:

- Standing
- Groggy
- Grounded
- Stunned
- Clinch / control situations where appropriate

These are not mutually exclusive Career “modes”; they are conditions that naturally occur during an MMA fight.

### Example experience

Instead of immediately receiving only the final result, the player could watch:

> Lewis lands a hard right hand.
>
> Torres is rocked.
>
> Torres shoots for a takedown.
>
> Lewis sprawls and takes the back.
>
> Torres scrambles to half guard.
>
> Lewis begins to slow late in the round.

The simulation remains automated; the player's strategic choices happen before the bout.

### Architecture rule

Preserve the stable underlying fight engine unless a dedicated simulation-engine pass explicitly replaces or extends it.

Do not mix this presentation feature casually into universe work.

---

# 5. Known Balance / Systems Backlog

These items were identified in Career audits but are intentionally deferred unless a dedicated pass reopens them.

## 🧪 Legacy / Camp Volume Balance

Short Notice creates substantially more fight volume and therefore can inflate Legacy despite added injuries / wear.

Needs a dedicated audit before tuning.

---

## 🧪 Displayed Fight Probability Calibration

Previously measured favorite probabilities in roughly the 50–80% range understated actual win rate by approximately 15–20 points.

This is sensitive because it touches player trust and potentially combat math.

Do not modify during unrelated passes.

---

## 🧪 Archetype Finish Anomaly

A prior audit observed Wrestler submission rate exceeding Submission Specialist in some samples.

Priority is low unless playtesting shows a visible problem.

---

## 🧊 Aging

Current aging curves were audited as healthy.

Do not retune casually.

---

## 🧊 Finish Distribution

Current broad distribution was audited as healthy.

Do not retune casually.

---

## 🧊 Championship Difficulty

Quality gradient is currently healthy enough that championship difficulty should not be casually reduced.

---

# 6. Product / UX Principles

## Career is decision-first

The Career tab should prioritize:

1. What just happened?
2. What do I need to decide now?
3. What am I working toward?

History comes afterward.

---

## Major events happen live

Promotions, contract opportunities, title wins and other major events should surface at the moment they occur.

Do not make Career History the only place the player discovers them.

---

## Matchmaking should be truthful

Labels should accurately represent the opponent underneath them.

Examples:

- Ranked Fight = actual ranked opponent
- Stay Busy = genuinely appropriate lower-risk booking
- Step-Up = meaningful upward opportunity
- Prospect Test = believable serious test

---

## Unranked does not mean bad

A fighter outside the Top 15 may be:

- 7-0
- a dangerous specialist
- a former contender
- an experienced gatekeeper
- a legitimate ranking-bubble fighter

---

## Rankings are earned within the circuit

Promotion into a new circuit does not automatically transfer official ranking.

Examples:

**4-0 Regional → National = UNRANKED**

But:

**National debut vs #14 → win → Top 15 is allowed.**

---

## Stable systems stay stable

Do not retune unrelated systems inside feature branches.

Prefer:

- focused branches
- explicit scope boundaries
- deterministic audits
- before/after cohort simulation
- regression checks
- PR review before the next system begins

---

# 7. Engineering / Validation Standards

Every substantial Career system should be validated against:

- LOW cohort
- AVERAGE cohort
- GOOD cohort
- ELITE cohort
- GOAT cohort
- multiple archetypes
- deterministic seeded simulation where practical

Typical large balance audit target:

**5 cohorts × 6 archetypes × 300 = 9,000 careers**

### Regression priorities

Protect:

- combat
- Matchmaking Realism
- Roster Ecology
- fresh-tier ranking behavior
- Scouting / Gameplan truth
- Mic Time
- callouts
- promotion milestones
- title flow
- Contender Series
- Camp
- aging
- Legacy
- timeline IDs
- save compatibility

---

# 8. Branch / PR Workflow

Preferred development workflow:

1. Audit / define the problem
2. Create a fresh branch from current `main`
3. Implement the smallest coherent pass
4. Run targeted deterministic tests
5. Run broader Career regression
6. Build + lint
7. Push branch
8. Review implementation report
9. Open PR
10. Verify exact diff + checks
11. Merge
12. Start the next branch only after the previous one is stable

Avoid mixing unrelated fixes unless they share the same architectural seam.

---

# 9. Future Expansion Ideas

## ⏳ Multi-Weight-Class Universe

Long-term, multiple weight classes could coexist and simulate simultaneously.

V1 Universe architecture should not prevent this, but it is not required yet.

---

## ⏳ Division Roster / Fighter Browser

Potential future UI:

- full Premier roster browser
- fighter profile
- current form
- record
- archetype
- peak rank
- history

Top 15 Rankings should remain a rankings screen rather than simply dumping the entire roster.

---

## 🧪 Roblox CageLab Concept

Experimental separate-product direction:

Adapt CageLab's Career / life-sim loop into a Roblox experience inspired by menu-driven life simulators.

Potential strengths:

- persistent Career progression
- randomized MMA life stories
- universe simulation
- social / leaderboard hooks
- strong fit with menu-driven Roblox experiences

This should remain a separate exploration until the core CageLab Career universe is mature enough to serve as a proven design foundation.

---

# 10. Current Priority Order

As of this roadmap revision:

1. ✅ **Persistent Universe Foundation V1 — merged (PR #35)**
2. ✅ **Active Career Save + Resume V1 — merged (PR #37)**
3. ✅ **NPC World Movement + Bout Ledger V1 — merged (PR #38)**
4. ✅ **Universe Events V1 — merged (PR #39)**
5. ✅ **Event Archive + Fighter Histories V1 — merged (PR #40)**
6. 🟡 **Visual Design Audit + CageLab Design System V2 — PR #41 open, direction-corrected, not yet merged**
7. ⏳ **Title Lineage + live-title-state correctness**
8. ⏳ **Universe News + Historical Presentation**
9. ⏳ **Move-by-Move Spectator Fight Simulation**
10. 🧪 **Dedicated balance passes only where playtesting/data justify them**
11. 🧪 **Roblox adaptation exploration later**

The exact ordering of post-Universe presentation work can change after playtesting, but the dependency chain should remain:

**Believable roster → persistent world → saved world → moving world → recorded history → browsable history → storytelling.**

---

# 11. Definition of the Long-Term CageLab Career

A finished CageLab Career should eventually be something the player can look back on as a unique alternate MMA history.

The save should be able to answer questions such as:

- Who was Premier champion when my fighter was still in Regional?
- Who did that champion beat for the belt?
- Which prospect went from 6-0 to Top 5 while I was climbing?
- Which veteran fell from #7 to gatekeeper?
- What event did I make my Premier debut on?
- Who else fought on that card?
- Who held the title before me?
- How many defenses did I make?
- What did the rankings look like during my run?
- Which rivals did I fight more than once?
- What were the biggest events of this universe?

That is the target:

> **CageLab is an MMA universe simulator where the player controls one fighter and builds a legacy inside a world that develops with or without them.**
