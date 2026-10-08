# Draft Strategy V2 — Baseline Audit

Status: evidence pass for issue #64. No gameplay rules changed.

The purpose of this audit is to answer the product question:

> Can CageLab make a lower visible rating a rational Draft pick because it better fits the fighter being built — without fake hidden bonuses?

The answer is now more precise:

**Not reliably under the current fixed-attribute / single-number transfer structure. A real opportunity cost is required.**

The strongest low-risk prototype is a **one-use source-fighter rule for Daily skill rounds**.

---

## Method

The committed audit is:

`scripts/draft-strategy-audit.mjs`

Run with:

`npm run audit:draft-strategy`

The full baseline uses:

- 24 real-roster fighter contexts;
- 32 real-roster benchmark opponents;
- all three player gameplans (stand-up, balanced, ground);
- every current Classic weight-class/era cell;
- 16 seeded Classic boards per cell;
- all three current development Fight Card fixtures;
- 32 seeded Daily boards per fixture;
- current `computeFightPreview()`;
- current `deriveTraits()`;
- current `boardFor()` / `boardForFightCard()`;
- current Build Value implementation.

Combat utility is the mean **best available pre-fight win probability** against the benchmark opponents after allowing the player to choose the best of the three existing gameplans.

This is an audit metric, not a proposed new player-facing score.

---

## Finding 1 — the current Draft structure makes “highest number” structurally dominant

A normal Draft round transfers only one thing from the selected fighter:

**the current attribute rating.**

If two candidates differ only in that one rating and the combat engine values that rating monotonically, there is no meaningful “fit” choice between them. The larger number weakly dominates.

That means systems such as:

- descriptive Build Qualities;
- archetype labels;
- diminishing-return copy;
- a “this fits your fighter” badge;

cannot, on their own, make an 82 rationally better than a 91 of the same attribute.

A lower pick needs a **real secondary consequence, opportunity cost, or tradeoff**.

---

## Finding 2 — current Daily is still overwhelmingly raw-highest

Sampled Daily boards: **96 per skill attribute**.

Raw-highest was also combat-best:

- Striking: **100%**
- Grappling: **100%**
- Wrestling: **100%**
- Cardio: **98.96%**
- Power: **90.63%**
- Chin: **100%**
- Speed: **100%**
- Fight IQ: **100%**

So the current combat engine does not naturally solve the Daily decision problem.

### The Power exception is mostly bad depth

Power is the largest apparent exception: a lower Power option beat the highest visible Power on about **9.4%** of sampled Daily boards.

The main cause is not an intuitive MMA tradeoff.

`COUNTER_STRIKER` currently requires:

`IQ >= 87 && POWER < 78`

and grants a direct **+0.02 win-probability modifier**.

Crossing from Power 77 → 78 can therefore remove the trait and make the fighter worse despite the higher rating.

That is opaque threshold gaming, not a mechanic we should build Draft Strategy around.

---

## Finding 3 — several hidden non-monotonic stat thresholds exist

Across 1,176 one-point comparisons per skill attribute:

- Striking: 0 decreases
- Grappling: 0 decreases
- Wrestling: 37 decreases
- Cardio: 2 decreases
- Power: 3 decreases
- Chin: 1 decrease
- Speed: 9 decreases
- Fight IQ: 1 decrease

### Trait-slot / threshold artifacts

Examples:

- Power 77 → 78 can remove Counter Striker.
- Speed 74 → 75 can remove Pressure Fighter.
- Raising Cardio / Chin / IQ can add an earlier trait, consume the effective trait-slot budget, and prevent Pressure Fighter from being derived.

These should be treated as combat-model design debt, not desirable lower-number strategy.

### Wrestling is different

Some Wrestling decreases occurred **without a trait change**.

Reason: Wrestling changes `groundShare`. On a fighter whose standing output is much stronger than their ground output, more Wrestling can pull the modeled fight toward a phase where that fighter performs worse.

That is a genuine build-dependent interaction in the current engine.

However, it is not currently visible or explainable enough to serve as the main Draft strategy mechanic, and the model effectively treats better wrestling as creating more ground time rather than more ability to choose where the fight happens.

It deserves separate design scrutiny before being surfaced as intentional strategy.

---

## Finding 4 — Height is an evaluation stat, not a combat stat

The current Career source explicitly documents:

> HEIGHT never feeds combat (only REACH does)

The audit confirms:

**Height combat delta from short to tall = 0.**

Yet relative Height produces values such as:

- 3 inches below class midpoint → score 60
- class midpoint → score 75
- 3 inches above class midpoint → score 90

and that score contributes to GOAT Score.

So the player is currently rewarded by Draft evaluation for maximizing Height even though Height cannot change a fight outcome.

This is a real product inconsistency.

Do not “fix” it with a simple hidden short/tall bonus. Physical-profile strategy needs a dedicated explainable design.

---

## Finding 5 — Reach is real but purely monotonic

Reach is used by `computeWinProbability()`.

Across the sampled fighter contexts, moving reach score from 50 → 99 increased combat utility by about **0.07** on average.

Current formula:

`(reachScore - 75) / 700`

So bigger normalized Reach is always better.

It is also measured against a neutral 75 baseline rather than the opponent's actual reach.

Reach therefore has real combat meaning, but it currently offers no lower-is-better tradeoff.

---

## Finding 6 — GOAT Score and combat do not value every rating point equally

Mean pre-fight utility gain per added rating point in the sampled contexts:

| Attribute | Mean utility gain / point |
| --- | ---: |
| Chin | 0.003333 |
| Fight IQ | 0.003000 |
| Cardio | 0.001917 |
| Speed | 0.001875 |
| Striking | 0.001471 |
| Grappling | 0.001445 |
| Wrestling | 0.000984 |
| Power | 0.000789 |

Caution: this metric uses pre-fight win probability. It does not fully price Power's contribution to damage/finish behavior inside the round simulation, so it must **not** be copied into GOAT Score as weights.

The useful conclusion is narrower:

**one raw rating point does not have identical combat meaning across attributes, while GOAT Score's base average treats them equally.**

That supports the roadmap decision to finish Draft Strategy research before Evaluation V2 changes GOAT Score.

---

## Finding 7 — Build Value contains useful specialization signal

Across the real roster:

**correlation(Build Value, raw skill average) ≈ 0.682**

That is high enough that general quality matters, but far from 1.0.

Within similar two-point skill-average bands, Build Value spreads were large:

- average ~72: **68-point** Build Value spread
- average ~78: **60-point** spread
- average ~74: **58-point** spread
- average ~70: **57-point** spread
- average ~76: **56-point** spread

So Build Value is detecting meaningful offensive shape/specialization beyond simple average rating.

Recommendation:

**do not make Build Value a second headline score, but keep its combat-model logic available as an internal research tool during Draft Strategy V2.**

---

# Structural Prototype — One Source Fighter Per Skill Draft

This audit tested one rule without changing production gameplay:

> During the eight Daily skill rounds, a source fighter can contribute at most once.

Height/Reach were intentionally left outside the prototype because the late physical pool has its own eligibility constraints.

Current fixture sizes:

- `card-2024-001-r1`: 8 fighters
- `card-2024-002-r1`: 10 fighters
- `card-2024-003-r1`: 8 fighters

So the rule is feasible for every current fixture.

On an 8-fighter card, all eight fighters contribute exactly one skill.

## Prototype mechanics used in the audit

For each skill round:

1. the normal seeded full fighter ordering is generated;
2. already-used fighters are removed;
3. the first five unused fighters become the visible board;
4. choosing a fighter makes that source unavailable for later skill rounds.

The full seeded round order is generated independently of the player's pick so choosing one fighter does not alter future RNG consumption.

The optimization objective in this structural test is deliberately simple:

**maximize the final sum of the eight skill ratings.**

That is **not** a proposal to score CageLab by raw sum. It isolates whether source allocation itself creates opportunity cost.

## Result

Across **384 simulated Daily drafts**:

- planning beat myopic “pick the highest current number” in **92.19%** of drafts;
- the optimal plan deliberately passed on a higher currently-visible number in **82.81%** of drafts;
- **28.29%** of all optimal skill picks were deliberate lower-number choices;
- average deliberate lower picks: **2.263 per draft**;
- average final eight-skill gain versus myopic play: **+17.555 rating points**;
- maximum gain: **+56**.

### By fixture

| Fixture | Fighters | Planning beats myopic | Drafts with deliberate lower pick | Lower picks / draft | Avg final gain |
| --- | ---: | ---: | ---: | ---: | ---: |
| card-2024-001-r1 | 8 | 98.44% | 98.44% | 3.000 | +22.234 |
| card-2024-002-r1 | 10 | 78.13% | 50.00% | 0.641 | +9.727 |
| card-2024-003-r1 | 8 | 100% | 100% | 3.148 | +20.703 |

### Representative example

One simulated card produced:

Power → IQ → Chin → Grappling → Speed → Wrestling → Striking → Cardio.

The optimal plan deliberately took:

- Dan Hooker **73 Chin** over Khabib Nurmagomedov **93 Chin**;
- Dustin Poirier **84 Grappling** over Khabib / Gregor Gillespie **91 Grappling**;
- Tony Ferguson **86 Striking** over James Krause **92 Striking**;

because preserving those source fighters for later attributes produced a final skill total of **697** versus **676** for the myopic highest-current strategy.

That is the target thought process:

> “The 93 is better right now, but I need that fighter somewhere else.”

No hidden combat bonus is required.

---

# Recommendation

## Prototype this rule next — do not ship it blindly

The one-use source-fighter rule is the first tested mechanism that clearly produces the strategy goal using a transparent, thematic opportunity cost.

It also strengthens Daily's identity:

> Build a fighter out of everyone who competed on this card.

On 8-fighter cards, that statement becomes almost literal during the skill draft.

### Important UX caveat

The optimizer used in this audit knows the future seeded board order.

The player currently does not.

Therefore the production prototype must **not** rely on unknowable future RNG to create its strategy.

Before shipping, test presentation approaches such as:

- visibly tracking which card fighters remain unused;
- showing the full skill-order queue;
- exposing enough of each fighter's remaining relevant ratings to support planning;
- potentially using a full-card/bench view or another predictable availability model rather than making the best plan depend on hidden future board order.

The rule is promising because of the source allocation constraint, not because the player should memorize an invisible seed.

---

# What not to do next

Do **not** respond to this audit by:

- adding arbitrary +5/+10 synergy bonuses;
- making Build Qualities secretly alter fights;
- weighting GOAT Score by the marginal table above;
- giving short fighters an automatic Power bonus;
- treating the Counter Striker / Pressure Fighter threshold quirks as desirable Draft depth;
- changing combat and Draft structure in one unmeasured pass.

---

# Next implementation gate

Recommended sequence:

1. merge this audit as evidence only;
2. build a contained **Daily source-allocation prototype** behind the current Fight Card Daily rules;
3. validate board/UX feasibility across many fixture shapes;
4. measure lower-number choice frequency, final build diversity, GOAT distribution, and player-readable decision quality;
5. separately resolve the Height/physical-profile contradiction;
6. only then decide what, if anything, Classic Draft should borrow;
7. feed the findings into Draft & Career Evaluation V2 / GOAT Score work.

The desired outcome remains:

> “I could take the 92, but I want to save that fighter for something more important later.”
