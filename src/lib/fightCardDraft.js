// =========================================================================
//  FIGHT CARD DAILY — Card-Scoped Draft Gameplay
//  Pure gameplay logic for drafting against an already-resolved immutable
//  FightCard fixture: CardFighter board offers, late weight-class roll, and
//  post-roll physical eligibility/boards.
//
//  Phase C owns fixture identity outside this module. App receives an
//  authoritative server assignment, resolves its exact fixture revision,
//  initializes the seeded RNG from assignment.seed, and only then calls the
//  functions below. Fixture selection deliberately does NOT live here, so a
//  browser cannot quietly reintroduce client-side Daily authority.
//
//  No React, App state, date logic, or Supabase lives here.
// =========================================================================
import { WEIGHT_CLASSES } from "../data/attrs.js";
import { BOARD_SIZE } from "../data/fighters.js";
import { shuffle } from "./rng.js";

// ---- CardFighter -\> Draft board-item adapter ----------------------------
// Shapes a CardFighter snapshot exactly like a MASTER_FIGHTERS record (the
// shape boardFor()/FighterPickCard/valueFor already expect: n, wc, era,
// ht, rc, the 8 skill keys, id) so the existing Draft UI needs no new
// fighter-shape branching. `era` is not part of the CardFighter schema --
// recovered from the tail of its authoring-time `appearanceId`
// (`...-<era>`, e.g. "...-lightweight-2010s") purely for display; never
// used for scoring. `sourceCardFighterId` is the one additive field,
// carrying Fight Card provenance through to picks/saved builds.
function eraFromAppearanceId(appearanceId) {
  const m = /-((?:19|20)\d0s)$/.exec(appearanceId || "");
  // "" (not null) -- this only ever feeds a display string
  // (FighterPickCard's "{wc} · {era}" subtitle), never a comparison.
  return m ? m[1] : "";
}

function adaptCardFighterToBoardItem(cf) {
  return {
    id: cf.id,
    n: cf.displayName,
    wc: cf.division,
    era: eraFromAppearanceId(cf.appearanceId),
    ht: cf.attributes.HEIGHT,
    rc: cf.attributes.REACH,
    STRIKING: cf.attributes.STRIKING,
    GRAPPLING: cf.attributes.GRAPPLING,
    WRESTLING: cf.attributes.WRESTLING,
    CARDIO: cf.attributes.CARDIO,
    POWER: cf.attributes.POWER,
    CHIN: cf.attributes.CHIN,
    SPEED: cf.attributes.SPEED,
    IQ: cf.attributes.IQ,
    sourceCardFighterId: cf.id,
  };
}

// ---- Card-scoped skill-round offers --------------------------------
// The whole card, any division, every skill round -- never boardFor(wc,
// era). Every CardFighter on the card is eligible every skill round
// regardless of division; the same fighter can be offered (and picked) in
// more than one round by design -- no one-appearance-per-draft restriction.
//
// Always seeded-shuffles before truncating to BOARD_SIZE -- including when
// the pool is already <= BOARD_SIZE. Unlike boardFor(wc, era) (whose
// MASTER_FIGHTERS pools are always 20+, so its own "skip the shuffle when
// the pool already fits" branch is effectively dead in practice), a Fight
// Card fixture's pools are frequently small by design (that's exactly what
// the thin-pool fixture exists to exercise) -- skipping the shuffle there
// would let fixture-authored array order silently become meaningful,
// seed-invariant gameplay presentation order. slice(0, Math.min(...))
// rather than a length check keeps the oversized/exact/thin cases as one
// rule, not three.
function boardForFightCard(fixture, rng = Math.random) {
  const pool = fixture.cardFighters;
  const chosen = shuffle(pool, rng).slice(0, Math.min(BOARD_SIZE, pool.length));
  return chosen.map(adaptCardFighterToBoardItem);
}

// ---- Late weight-class roll ----------------------------------------
// Candidates: the fixture's represented divisions (derived from its own
// bouts, already validated as supported WEIGHT_CLASSES values at
// authoring time -- see validateFightCardFixture). Equal probability per
// represented division, independent of fighter count/bout count/rating,
// per the current development rule. Exactly one rng draw -- call this
// once, at the one fixed point in the sequence (after skill pick #8,
// before Height), never speculatively or more than once per draft.
function resolveLateWeight(fixture, rng = Math.random) {
  const candidates = Array.from(new Set(fixture.bouts.map((b) => b.division)))
    .filter((d) => WEIGHT_CLASSES.includes(d));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// ---- Physical eligibility pool (development rule, provisional) ------
// Target division + immediately adjacent supported divisions (CageLab's
// existing WEIGHT_CLASSES order), restricted to CardFighters actually on
// this fixture. This is the current DEVELOPMENT rule carried over from
// the Phase 2/2B findings -- not a locked production policy. No minimum
// count, no fallback, no fabricated offers: a thin result (0, 1, 2
// fighters) is returned exactly as found. Callers decide what to do with
// a too-small pool; this function never pads one.
function resolvePhysicalPool(fixture, targetDivision) {
  const idx = WEIGHT_CLASSES.indexOf(targetDivision);
  if (idx === -1) return [];
  const eligible = new Set([WEIGHT_CLASSES[idx - 1], WEIGHT_CLASSES[idx], WEIGHT_CLASSES[idx + 1]].filter(Boolean));
  return fixture.cardFighters.filter((cf) => eligible.has(cf.division));
}

// Draws a board from an already-resolved physical pool (see
// resolvePhysicalPool) -- same always-shuffle-then-truncate rule as
// boardForFightCard (see its own comment for why this differs from
// boardFor's skip-when-already-small shortcut). Call once per physical
// round (Height, then Reach) for an independent draw each time, matching
// every other round's own independent re-roll. Never pads/duplicates: a
// pool smaller than BOARD_SIZE is shuffled and shown in full, exactly as
// found (e.g. the thin card-2024-003-r1/Heavyweight case: 2 candidates
// in, 2 shown, order seeded).
function boardForPhysicalPool(pool, rng = Math.random) {
  const chosen = shuffle(pool, rng).slice(0, Math.min(BOARD_SIZE, pool.length));
  return chosen.map(adaptCardFighterToBoardItem);
}

export {
  adaptCardFighterToBoardItem,
  boardForFightCard,
  boardForPhysicalPool,
  eraFromAppearanceId,
  resolveLateWeight,
  resolvePhysicalPool,
};
