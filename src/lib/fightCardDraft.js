// =========================================================================
//  FIGHT CARD DAILY V2 -- Phase B: Card-Scoped Draft Sequencing
//  Pure gameplay logic for drafting against a Phase A FightCard fixture:
//  which fixture a Daily run uses, how its CardFighters become board
//  offers, the late weight-class roll, and the post-roll physical pool.
//  No React, no App.jsx state, no Supabase -- this module only consumes
//  immutable fixture data (src/data/fightCards.js) and a seeded rng
//  function, and returns plain data. App.jsx wires it into the existing
//  Draft state machine; it never needs to know how a board was produced.
//
//  Scope boundary: this is the DEVELOPMENT-fixture vertical slice only.
//  - selectDevelopmentFixture() is the "smallest clean mechanism" asked
//    for in Phase B -- NOT the production date-\>fixture assignment
//    architecture. It is isolated behind this one function specifically
//    so Phase C can replace it with authoritative assignment (Supabase,
//    an RPC, a pre-populated pool, whatever that phase decides) without
//    touching anything below it or in App.jsx's Draft engine.
//  - resolvePhysicalPool()'s target+adjacent rule is the current
//    DEVELOPMENT policy carried over from the Phase 2/2B findings, not a
//    locked production rule. No fallback, no minimum-count guarantee, no
//    fabricated offers -- see its own comment.
// =========================================================================
import { WEIGHT_CLASSES } from "../data/attrs.js";
import { BOARD_SIZE } from "../data/fighters.js";
import { shuffle } from "./rng.js";

// ---- Fixture selection (development-only mechanism) ---------------------
// Smallest clean seam for "which fixture does today's Daily use": one
// deterministic rng draw over the supplied fixture list. Callers pass
// whatever fixture list they like (Phase A's listFightCardFixtures() in
// production use) so this function never hard-codes a dependency on
// fightCards.js's exact export shape beyond "array of fixtures".
//
// UNRESOLVED FOR LATER PHASE (unchanged from Phase A/2B): this is NOT the
// authoritative UTC-date-\>fixture assignment mechanism. It has no notion
// of "today," no Supabase reference, and does not guarantee the same
// fixture is chosen across independently-deployed clients for the same
// calendar date -- it only guarantees the same fixture for the same
// (fixtures list, rng) pair, which is all a development vertical slice
// needs. Phase C replaces the call site, not this function's contract.
function selectDevelopmentFixture(fixtures, rng = Math.random) {
  if (!fixtures || fixtures.length === 0) return null;
  return fixtures[Math.floor(rng() * fixtures.length)];
}

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
// era). Same draw-pattern as boardFor itself: shuffle+slice only when the
// pool exceeds BOARD_SIZE, otherwise return the whole (already-small)
// pool in its fixture-authored order -- so a thin fixture behaves exactly
// like boardFor's own "pool.length <= BOARD_SIZE" case, not a special one.
// Every CardFighter on the card is eligible every skill round regardless
// of division; the same fighter can be offered (and picked) in more than
// one round by design -- no one-appearance-per-draft restriction.
function boardForFightCard(fixture, rng = Math.random) {
  const pool = fixture.cardFighters;
  const chosen = pool.length <= BOARD_SIZE ? pool : shuffle(pool, rng).slice(0, BOARD_SIZE);
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
// resolvePhysicalPool) -- same shuffle-only-when-oversized pattern as
// boardForFightCard/boardFor. Call once per physical round (Height, then
// Reach) for an independent draw each time, matching every other round's
// own independent re-roll.
function boardForPhysicalPool(pool, rng = Math.random) {
  const chosen = pool.length <= BOARD_SIZE ? pool : shuffle(pool, rng).slice(0, BOARD_SIZE);
  return chosen.map(adaptCardFighterToBoardItem);
}

export {
  adaptCardFighterToBoardItem,
  boardForFightCard,
  boardForPhysicalPool,
  eraFromAppearanceId,
  resolveLateWeight,
  resolvePhysicalPool,
  selectDevelopmentFixture,
};
