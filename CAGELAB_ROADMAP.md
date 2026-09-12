# CageLab Development Roadmap

_Last updated: 2026-09-12_

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
>
> **Update log (2026-09-12, roadmap only):** Playtest/review exposed two
> evaluation problems: GOAT Score + Build Value create unnecessary
> duplicate headline scoring right after Draft, and retirement verdicts
> lean too heavily on accumulated Legacy Score with too little
> résumé/context nuance (a mediocre record can still read as
> celebratory). Added **Draft & Career Evaluation V2** to the roadmap,
> slotted after Design System V2 and before Title Lineage — planning
> only, not yet implemented. Universe News and Rankings History each move
> one slot later in Section 10's priority order to make room for it.
>
> **Update log (2026-09-12, addendum, roadmap only):** Playtesting exposed
> a deeper problem underneath Draft & Career Evaluation V2: Daily
> Challenge's lack of rerolls makes the broader Draft strategy problem
> especially visible — when most ratings are monotonic, selecting the
> highest available number is often just the obvious correct choice, in
> Daily and (to a lesser extent) Classic alike. Added **Draft Strategy +
> Daily Challenge V2** to the roadmap, slotted between Design System V2
> and Draft & Career Evaluation V2 — draft strategic depth needs to be
> established before finalizing how GOAT Score evaluates the builds it
> produces. Planning only, not yet implemented.
>
> **Update log (2026-09-12, correction, roadmap only):** Replaced Daily
> Challenge V2's earlier "rotating generic objectives" concept (Compact
> Powerhouse, Ground Specialist, etc. — now demoted to a possible future
> extension) with a clearer locked core identity: **"Build a fighter out
> of everyone who competed on this card."** Each Daily is drawn from one
> historical fight card's fighter pool, with a skill-first /
> weight-class-late / physical-after draft ordering (weight class can no
> longer be locked before the skill draft, since a card spans multiple
> weight classes). Added physical-eligibility, adaptive-pick-count,
> fighter-non-uniqueness, presentation, and historical-data-rights
> considerations. The broader Draft Strategy investigation (highest-
> number dominance, synergy, physical tradeoffs) is unchanged and still
> applies to Classic and Daily alike. Planning only, not yet implemented.
>
> **Update log (2026-09-12, status bookkeeping):** Visual Design Audit +
> CageLab Design System V2 (PR #41) is **merged** into `main` (merge
> commit `4a8f2237`). Regression check confirmed `career.js`, `scoring.js`,
> and `storage.js` are byte-identical to pre-PR `main` — no gameplay logic
> was touched. Corrected this doc's "what shipped" wording: the
> `FighterSilhouette` component was prototyped on Draft and Stats during
> this pass but was cut after review (read as clutter) and ships nowhere
> in the merged version; the component itself stays in the tree unused.
> Draft Strategy + Daily Challenge V2 moves to 🔜 Next in Section 10 — it
> remains planning-only, not implemented.

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

## ✅ Visual Design Audit + CageLab Design System V2 — merged (PR #41)

**Status: merged** into `main` via **PR #41** (merge commit
`4a8f2237`).

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
- **Draft screen — false-affordance fix**: the old boxed attribute grid
  (looked like a second, clickable menu next to the real draft board) is
  replaced with a plain-text, read-only Scouting Summary (best-so-far/
  weak-spot, gold/red respectively) listing revealed attributes as they're
  drafted, each with a one-shot gold reveal animation on the row that just
  landed. Draft completion is shown as a slim gold progress bar (reusing
  the existing progress-bar pattern from Camp), not a separate visual. A
  "Draft Board / Choose 1 fighter this round" heading and a gold accent
  bar make the actual candidate cards the clear primary surface, with a
  new desktop hover state on each card.
  A decorative `FighterSilhouette` component was prototyped on both the
  Draft screen and the Stats tab during this pass but was cut after
  review read it as clutter competing with the Scouting Summary/progress
  bar it sat next to — it shipped nowhere in the final merged version.
  The component (with its brass-not-red color-lerp fix) is left in the
  tree unused, available if a future pass finds a place for it, per the
  PR's own "known limitations."
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

## ⏳ Draft Strategy + Daily Challenge V2

### Goal

Make the best Draft pick depend on the fighter being built, not on which
available number is largest, and give Daily Challenge its own identity:
**"Build a fighter out of everyone who competed on this card."** Placed
after Design System V2 and **before** Draft & Career Evaluation V2,
because draft strategic depth should be established before finalizing
how GOAT Score evaluates the builds it produces — specialization
findings here may change what a good scoring formula should reward.

### The problem

Playtesting exposed that, too often, the rational Draft strategy is
simply "pick the highest available number." This is most visible in
Daily Challenge specifically because Daily has no rerolls, players see a
fixed choice set, and higher attribute values are generally monotonic
upgrades — so the "decision" often reduces to selecting the largest
number. Classic Draft feels somewhat better because rerolls introduce
risk/resource management and pools aren't always strong, but even Classic
can fall into the same highest-number-is-correct pattern. The underlying
problem is **Draft strategic depth**, not Daily Challenge alone.

### Core design principle

The goal is NOT to make low ratings secretly better. The goal is to make
the best pick depend on the fighter being built — a player should
sometimes rationally choose an 82 over a 91 because the 82 better
completes the intended fighter/profile/objective. Draft should create
**build decisions**, not merely **number comparisons**.

**Illustrative example only, not a locked mechanic:** a player attempting
to build something like a short, compact, extremely powerful pressure
fighter today has little mechanical reason to intentionally take shorter
Height/Reach if higher physical scores are simply better across the
board. A future system should explore whether different physical/body
profiles can create truthful tradeoffs — but do not roadmap a simplistic
rule like "short fighter = automatic Power bonus." Any such interaction
requires an audit of whether physical dimensions can meaningfully affect
fighting style, range, pressure, speed, wrestling/entries, power, and
defensive exposure without creating a fake or gamey relationship.

### Required audit before designing anything

Future implementation must measure, not guess:

- how often the highest available score is currently the optimal pick
- attribute-by-attribute pick dominance
- reroll behavior
- whether synergies materially change optimal choices today
- whether archetypes influence picks
- whether Height/Reach are effectively linear "bigger is better"
- whether any current lower-value choice is already strategically rational
- whether GOAT Score over-rewards raw average/balance
- whether current Build Qualities actually influence choice, or merely
  describe the result afterward

### Possible strategy mechanisms — not locked

The implementation phase should prototype alternatives, for example:

- **Build synergy/fit** — an attribute's value depends partly on what's
  already drafted (e.g. an 84 Wrestling option may improve a developing
  ground fighter more than a numerically higher stat elsewhere).
- **Physical profile tradeoffs** — height/reach/body profile creating
  real strengths and weaknesses rather than a purely linear quality
  ladder.
- **Diminishing returns** — a fourth elite attribute in an
  already-dominant area offering less strategic value than fixing an
  important weakness.
- **Style/archetype targets** — drafted attributes forming meaningful
  combat identities whose effectiveness is more than raw average rating.
- **Trait/profile interactions** — certain combinations producing
  recognizable fighter qualities.

Any such system must stay grounded in the actual combat engine. Do not
add fake "+10 because synergy badge" bonuses without simulation
justification, and avoid a hidden combo table — the player should be
able to reason "I already have elite wrestling and cardio; this
grappling pick completes the fighter," never "these two cards secretly
trigger +12." Synergies/tradeoffs must be explainable, visible, and
connected to actual combat behavior.

### Daily Challenge V2 — core fantasy (locked direction)

**This supersedes the earlier "rotating generic objectives" concept
below.** Daily Challenge's core identity is now:

> **"Build a fighter out of everyone who competed on this card."**

Preserve this one-sentence pitch prominently — it is the current product
north star for Daily Challenge V2. Each Daily Challenge is based on one
fight card/event; the fighters who competed on that card become the
source pool for that day's draft. Every player receives the same card,
fighter pool, draft conditions, and available choices/deterministic seed
where appropriate — preserving Daily's leaderboard/comparison value while
giving the mode an identity Classic and Blind don't have. The card itself
creates the daily variation (different cards naturally produce different
strengths, weaknesses, styles, and physical profiles) — Daily should not
need an arbitrary gimmick/modifier every day just to feel different.

### Draft ordering — skill first, weight late, physical after

The current architecture locks weight class before drafting, which
conflicts with this concept: historical fight cards contain fighters from
multiple weight classes. Daily Challenge V2 should investigate a
different ordering:

**skill draft first → weight class late → physical draft after weight is
known.**

- **Skill attributes** (Striking, Grappling, Wrestling, Cardio, Power,
  Chin, Speed, Fight IQ — use the actual CageLab attribute
  definitions/order when implementation begins) are drafted from
  *everyone who competed on the card, regardless of their weight class*.
  If a card contains elite Heavyweight Power, elite Lightweight Speed,
  elite Welterweight Wrestling, and elite Middleweight IQ, the player can
  potentially combine all of those into one drafted fighter — that
  combination is the fantasy of the mode.
- **Weight Class** is then determined as a late draft event, after the
  skill attributes are set. The exact mechanic is not locked —
  implementation should prototype: (A) randomly rolled from weight
  classes represented on the card, (B) presented as a choice among weight
  classes represented on the card, or (C) another fair/deterministic
  Daily mechanism. Current preference is that Weight Class lands late
  enough to create adaptation rather than defining the whole draft
  upfront; for leaderboard fairness, all players must face equivalent
  conditions.
- **Physical attributes remain part of the draft** — this is an explicit
  correction: do not bundle Height/Reach into one automatically-inherited
  "Physical Profile." After Weight Class is known, the player drafts
  Height and then Reach (use the actual CageLab physical-attribute
  structure when implementation begins) from eligible fighters on that
  day's card.

### Physical eligibility (needs audit, not assumed)

Once Weight Class is known, physical choices need to make sense in that
context — implementation must not simply let a Heavyweight's raw
measurements become available to a Lightweight body without checking how
the current systems interpret them. Audit Height, Reach, Weight Class,
physical normalization, combat calculations, draft scoring, and fighter
generation before selecting the eligibility rule. The desired player
experience is still: draft physical characteristics from fighters
represented on the card.

### Adaptive physical pick count

Historical cards may not contain enough appropriate fighters to support
the normal number of Height/Reach choices — that should not kill the
concept. Daily may use a smaller option count for physical rounds (e.g.
4 instead of a normal 6), with a lower emergency minimum only if data
proves necessary; exact counts are not locked. Principle: reduce the
number of physical choices when necessary rather than populate the round
with fake/inappropriate fighters.

### Do not require six unique fighters

The game is drafting attributes, not assembling a team roster — audit
whether the same fighter can legitimately appear as an option in multiple
rounds (e.g. contributing Power in one round, Chin in another, and
potentially a physical attribute later). Do not artificially require
every attribute source to be a unique fighter unless playtesting shows
that improves the mode.

### The card is the constraint

Daily should not need arbitrary restrictions just to manufacture
difficulty. The main constraint is simply: **you can only build from the
fighters who fought on this card.** That alone creates natural
day-to-day variation — a stacked card may produce an extremely powerful
build, a strange card may create difficult compromises, a
wrestling-heavy card may naturally encourage certain builds, a
striker-heavy card may naturally encourage others. That variation is
desirable and does not need to be manufactured further.

### Presentation

Daily should lead with the fight card/event — conceptually: "DAILY
CHALLENGE — TODAY'S CARD — [Event] — 'Build a fighter out of everyone who
competed on this card.'" Show the fighters/bouts represented on the card
before or during the draft so the player immediately understands *why*
these particular fighters are appearing. As part of the broader Draft
Strategy audit, also investigate leading picks with fighter identity
rather than a raw number — closer to "FIGHTER NAME — Power 94" than a
bare "94 / 88 / 82" list — to reinforce "I am taking this fighter's
Power" rather than "I am clicking the largest integer." The rating stays
visible either way; the player still needs transparent information, just
attached to a name. The exact card UI is not locked.

### Historical card data — content/legal dependency

The gameplay concept does not depend on UFC branding specifically, but
before production implementation, determine what historical fighter
names, event names, promotion names, statistics, likenesses, and imagery
CageLab can legally/commercially use. Do not assume real UFC branding,
fighter imagery, or proprietary datasets can simply be shipped — this
mechanic must be designed independently of any particular promotion
license. Possible eventual sources: appropriately usable real historical
data, licensed data, fictionalized CageLab cards, or other legally
suitable sources. This is a content/legal research dependency, not a
reason to change the gameplay concept.

### Relationship to Classic and Blind Draft

Do not automatically move Classic Draft to this skill-first/weight-late
ordering — Classic keeps its own division-selection + reroll + existing
draft flow, and the broader Draft Strategy "highest number usually wins"
investigation still applies to it independently. Blind also stays
conceptually separate (its challenge is information uncertainty, not
fight-card assembly). Target mode identities: **Classic** = the normal
CageLab draft structure with reroll/resource decisions; **Blind** =
information uncertainty is the challenge; **Daily** = build a fighter
from one shared fight card. These three should feel meaningfully
different from each other.

### Rotating objectives — demoted, not deleted

The previously-discussed rotating objectives (Compact Powerhouse, Ground
Specialist, Five-Round Machine, Specialist, Giant Killer, Balanced
Champion) are **no longer the primary Daily Challenge V2 design.** Keep
the idea in the roadmap as a possible future extension only — special
Daily variants, bonus objectives, achievements, or alternate challenge
types layered on top of the fight-card structure — not the core Daily
identity, which is now the fight-card draft above.

### The broader Draft Strategy problem still applies

The fight-card concept fixes Daily's *mode identity* — it does not by
itself solve "highest number = best pick." Classic and Daily both still
need the build-synergy/specialization/physical-tradeoff/archetype-
viability/diminishing-returns/combat-model-fit/pick-diversity
investigation described above (see "Possible strategy mechanisms"). Do
not introduce arbitrary hidden bonuses to either mode.

### Dependency: GOAT Score

This phase must happen *before* Draft & Career Evaluation V2. Current
GOAT Score strongly values average quality, elite ratings, balance, and
avoiding weaknesses — which may unintentionally penalize a deliberately
specialized but highly effective fighter. Draft & Career Evaluation V2
must use findings from this phase; do not finalize a GOAT Score revision
before this audit.

### Dependency: Build Value

Do not roadmap immediate deletion of Build Value's internals. Although it
should no longer be a co-equal headline rating (see Draft & Career
Evaluation V2), its combat-model-based analysis may be genuinely useful
during this phase's research. The later Evaluation V2 implementation
still decides whether to remove it, retain it internally, or repurpose it
as deeper analysis.

### Validation requirements

Future implementation should quantify: % of picks where the highest
number is selected, % where the highest number is objectively dominant,
pick diversity, archetype diversity, final build diversity, reroll usage,
Daily leaderboard score spread, repeated dominant strategies, specialized-
build viability, and representative combat performance. A successful
redesign should measurably reduce "always pick the highest number"
without replacing it with "always follow one optimal recipe."

### Daily fight-card validation

Before implementation is considered complete, test a large sample of
candidate fight cards — not just one famous stacked card, since the
system needs to survive ordinary and unusual cards too. Measure: number
of fighters per card, number of represented weight classes, fighters
available per weight class, option availability for every attribute,
frequency of reduced physical pick counts, duplicate-fighter-appearance
frequency, attribute-value distributions, final build distributions,
Daily leaderboard score distributions, pick diversity, frequency with
which the highest raw number is selected, and cards that cannot support
the intended draft format at all.

### Success principle

The ideal Draft thought process becomes: "I could take the 92... but the
84 actually fits the fighter I'm building better." A Daily player should
be able to open the mode and immediately understand "everyone today is
building from this fight card," then think through the draft as "whose
Wrestling do I want?", "whose Power fits what I've already built?", and
late in the draft "what weight class am I getting?", "what Height/Reach
options does that leave me?" The finished fighter should feel like a
unique combination of fighters from one night of MMA history — not "which
card has the biggest number?"

### Explicit non-goals (this phase)

- No draft/scoring/Daily code changes in this roadmap pass — planning only
- No combat-simulation changes (`resolveFight`, `simulateRounds`,
  `computeWinProbability`, finish math, World Movement, NPC resolver,
  matchmaking all remain untouched)
- No locked list of synergy tables, physical-profile bonus rules, weight-
  class-timing mechanic, physical-pick-count thresholds, or fighter-
  uniqueness rule — all of the above are conceptual examples for the
  implementation/audit phase to prototype and validate, not requirements
  to build as written
- No assumption that real UFC (or any specific promotion's) branding,
  fighter imagery, or proprietary data can be used — content/legal
  sourcing is a separate research dependency from the gameplay concept
- The rotating-objective concept (Compact Powerhouse, Ground Specialist,
  etc.) is demoted to a possible future extension, not part of this
  phase's core deliverable

---

## ⏳ Draft & Career Evaluation V2

### Goal

Make the beginning and end of a CageLab career easier to understand:

- one clear answer for "How good is the fighter I drafted?"
- one nuanced answer for "What kind of career did I actually have?"

Placed after Draft Strategy + Daily Challenge V2 and before Title
Lineage: the Draft presentation itself now feels substantially better
and is considered visually locked for the moment, but a new design issue
was identified around two evaluation moments — the Draft-result score(s)
and the end-of-Career verdict — worth fixing together before more
text-heavy presentation work (Title Lineage, Universe News, Rankings
History) builds on top of them. This phase must come *after* Draft
Strategy + Daily Challenge V2 specifically because draft specialization
findings there may change what GOAT Score should reward (see that
section's "Dependency: GOAT Score").

### Problem A: Draft evaluation (GOAT Score vs. Build Value)

The current draft-result screen exposes two prominent abstract 0–100
values, GOAT Score and Build Value. The underlying formulas are
genuinely different — GOAT Score evaluates overall completeness/balance
and weak spots; Build Value evaluates a narrower form of functional
offensive danger — but from the player's perspective, presenting both as
large headline ratings asks them to understand two overlapping abstract
scores immediately after one draft. That's unnecessary cognitive load.

**Locked direction:**

- **Keep GOAT Score** as the ONE primary/headline draft score. It should
  answer "how good/complete is the fighter I built?"
- **Remove Build Value as a second co-equal headline score.** Do not
  blend the two formulas into a new mystery composite. Possible future
  handling: remove from the player-facing result entirely, retain
  internally, or expose deeper in an optional Build Analysis view if it
  proves genuinely useful — the implementation phase must audit this
  before deleting any analytical code that might still be worth keeping.
- **Keep the "GOAT Score" name.** It has established CageLab identity and
  personality; do not roadmap a rename to "Build Score." The
  implementation/audit phase may verify whether playtesters actually
  misunderstand the label, but a rename is not planned unless future
  feedback justifies it.

### Problem B: End-of-Career evaluation (Legacy Score + retirement verdict)

The current final verdict system does not provide enough nuance.
Observed product problem: careers with mediocre-looking records — e.g.
something around 12–11 — can still receive presentation/copy that makes
the career feel unusually successful or emotionally celebrated. Part of
this comes from the current architecture: Legacy accumulates throughout
the career, wins can add substantial Legacy, losses subtract less in many
situations, running Legacy is floored at zero, retirement adds further
bonuses, and the final verdict primarily keys off Legacy thresholds, then
applies a cap based on highest circuit reached. That can be mathematically
reasonable in some cases — record alone shouldn't determine career
quality — but the verdict currently lacks enough résumé/context awareness
to explain *why* a middling record might still represent a respectable
career, and lower-level careers are often written too generously.

**Product principle — mediocre careers must exist:** CageLab must be
willing to tell the player a career was disappointing, ordinary,
journeyman-level, respectable but unspectacular, good but not great,
excellent, or legendary. Not every completed career should feel heroic —
ordinary careers make genuinely great careers feel special. The
retirement presentation should not automatically congratulate every
fighter as though they left a major legacy.

### Score separation (do not merge these)

- **GOAT Score** = quality of the drafted fighter/build ("how good is
  what I built?")
- **Legacy Score** = numerical résumé strength, what the player
  accomplished during the career ("what did I do with it?") — **Legacy
  Score is not being removed.** The change is that Legacy Score should
  not, by itself, determine the entire emotional/categorical retirement
  verdict.

### Preferred future architecture: two-layer career evaluation

**A. Career Standing / Career Level** — what competitive level did the
fighter actually establish themselves at? Conceptually (exact labels not
locked): Regional Fighter, Regional Standout, National Mainstay, Premier
Veteran, Ranked Contender, Elite Contender, Champion, Dominant Champion.
Reflects circuit reached, rankings reached, championships, sustained
competitive level.

**B. Legacy Verdict** — how historically meaningful was the career?
Conceptually (exact labels not locked, terminology needs
research/tuning): Never Broke Through, Journeyman, Respected Veteran,
Contender, Fan Favorite, Champion, Hall of Fame, All-Time Great.

**Why two layers help** (illustrative examples only, not implementation
requirements or locked copy):

- 12–11, Premier, peak #9, no title → could reasonably read as **Premier
  Veteran**: "You reached the highest level and proved you belonged, but
  never separated yourself from the pack."
- 12–11, Premier Champion, 0 defenses → could reasonably read as
  **Former CLF Champion**: "An uneven career with one unforgettable peak.
  You reached the summit, but couldn't stay there."

Two very different careers despite identical records.

### Résumé-gating requirement

High-end verdicts should likely require actual accomplishment conditions
in addition to Legacy points, not Legacy points alone. Conceptually
investigate gates such as: Legitimate Contender (credible ranked/top-level
success), Fringe HOF (meaningful Premier résumé / elite longevity /
serious title contention), Hall of Fame (Premier championship OR a truly
exceptional non-champion résumé), First-Ballot HOF (Premier title success
plus defenses/reigns/outstanding résumé), Generational (sustained Premier
title dominance + elite accomplishments). Do not lock exact thresholds
before simulation testing.

### Record-context requirement

Future evaluation should account for record quality, but must not reduce
career quality to win percentage alone. Relevant context: overall record,
win percentage, Premier record, ranked-fight record, Top-15/Top-10/Top-5
performance, title-fight record, championships, title defenses, quality
of opposition, peak rank, statement wins, major losing stretches,
late-career decline, career longevity. Example principle: 12–11 in
Premier against elite competition is not equivalent to 12–11 in Regional;
12–11 with a meaningful championship run is not equivalent to 12–11 while
repeatedly losing ranked fights.

### Losses / negative-context audit (answer later, not now)

Implementation should audit whether current Legacy accumulation
structurally over-rewards activity: are wins worth too much relative to
losses; does flooring `runningLegacy` at zero create score inflation; do
retirement bonuses accumulate too easily; does ranked-fight count reward
merely participating too much; do losses at elite level need better
contextual handling; are title shots rewarded too heavily relative to
title success. This roadmap entry does not decide the answers — it
requires simulation/data before tuning.

### Retirement copy V2

Retirement narrative should be driven by actual career context and have
real tonal range — poor/failed (never established at higher levels,
failed prospect, losing career, brief run), journeyman/respectable (tough
veteran, credible professional, belonged but never contended), good
(ranked contender, title challenger, high-level veteran), great (champion,
successful defenses, Hall of Fame), elite (dominant champion, multiple
reigns, generational career). Avoid universal sentimental language like
"the career mattered, win or lose" when the actual career was
unsuccessful.

### End-screen presentation goal

The final Career screen should eventually answer at a glance: what was my
record, how far did I get, what did I win, how good was my résumé, what
is my legacy, and why did the game give me this verdict — the verdict
should feel explainable, not arbitrary.

### Explainability

Expose enough supporting context that a player understands the verdict.
Possible retirement-summary fields: Record, Peak Circuit, Peak Rank,
Ranked Record, Premier Record, Championships, Defenses, Title Fight
Record, Best Win, Legacy Score, Career Standing, Final Verdict. Not every
field is required if the final screen becomes too dense — the
implementation pass should find the smallest clear set.

### Validation requirement

This phase must NOT be tuned from a handful of manual careers. Requires
distribution testing across thousands of careers, measuring: verdict
distribution by cohort, average record per verdict, Premier reach per
verdict, championship frequency per verdict, defenses per verdict,
losing-record frequency by verdict, near-.500 record frequency by
verdict, non-champion Hall of Fame frequency, champion-failing-HOF
frequency, Generational frequency — plus inspection of real representative
careers from every verdict tier. Specific sanity cases to test: (A) 12–11
Premier veteran, peak #9, no belt; (B) 12–11 brief Premier champion, 0
defenses; (C) 18–6 Top-5 contender, never champion; (D) 16–8 Premier
champion, 3 defenses; (E) 9–10 National career; (F) 24–4 dominant Premier
champion; (G) an elite lower-tier career that never reaches Premier. The
system should distinguish these based on résumé, not just one score
threshold.

### Existing-save compatibility

Requires an explicit policy: do not silently rewrite old completed
careers unless a migration policy is intentionally chosen. Active careers
completed after the new system should use V2 verdict logic; completed
historic entries may preserve their original verdict unless a
display-time reinterpretation is deliberately added. Implementation must
audit before choosing.

### Meta/achievement compatibility

Because some meta achievements currently inspect career verdict
text/categories, implementation must audit Hall of Fame achievements,
Career History, Collection/My Legacy, saved career summaries,
export/import compatibility, any regex/string matching against verdict
labels, and leaderboards if applicable. Do not casually rename verdict
strings without migration/compatibility planning.

### UI relationship to Design System V2

Use the now-established CageLab visual direction: Draft gets one dominant
GOAT Score; Retirement gets strong hierarchy between Career Standing,
Legacy Score, and Final Verdict. Avoid adding another pile of competing
abstract 0–100 numbers.

### Explicit non-goals (this phase)

- No Title Lineage, Universe News, or Rankings History implementation
- No move-by-move spectator simulation
- No new combat or draft mechanics
- No fighter portraits
- No combat-simulation changes of any kind — `resolveFight`,
  `simulateRounds`, `computeWinProbability`, finish math, World Movement,
  the NPC resolver, and matchmaking are explicitly frozen for this phase.
  This is draft evaluation + career résumé evaluation + retirement
  presentation, not a combat balance pass.

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
6. ✅ **Visual Design Audit + CageLab Design System V2 — merged (PR #41)**
7. 🔜 **Draft Strategy + Daily Challenge V2**
8. ⏳ **Draft & Career Evaluation V2**
9. ⏳ **Title Lineage + live-title-state correctness**
10. ⏳ **Universe News + Historical Presentation**
11. ⏳ **Rankings History / deeper universe storytelling**
12. ⏳ **Move-by-Move Spectator Fight Simulation**
13. 🧪 **Dedicated balance passes only where playtesting/data justify them**
14. 🧪 **Roblox adaptation exploration later**

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
