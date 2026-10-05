// =========================================================================
//  FIGHT CARD DAILY V2 -- Phase A: Fixture Foundation
//  Independent, self-contained "card" data for the future Fight Card Daily
//  mode ("build a fighter out of everyone who competed on this card").
//  This module is intentionally isolated from Career's `universe.events`,
//  the Daily leaderboard, Draft state, and Supabase -- nothing here is
//  wired into gameplay yet.
//
//  Immutability contract:
//  - A fixture's `id` is a specific, immutable revision (`card-YYYY-NNN-rN`).
//    A future correction to a fixture's data is a NEW id with an
//    incremented `-rN` suffix, never an edit of an existing one.
//  - `schemaVersion` is a separate concept from the revision suffix: it
//    describes the shape of the fixture record itself, not which cut of
//    the card this is. Do not conflate the two.
//  - Every fixture below is a frozen, fully self-contained, literal
//    snapshot (see "AUTHORING vs RUNTIME" below) -- this file has no
//    import of and no dependency on MASTER_FIGHTERS at all, so there is
//    no runtime lookup, fuzzy-matching, or fallback of any kind.
//
//  Provenance (Phase A): the three fixtures below are marked
//  `source: "development"` -- they are synthetic development fixtures
//  assembled from MASTER_FIGHTERS's existing (already-fictionalized-in-
//  rating, real-name) roster, not claims about any real historical event,
//  date, or card. They must not be presented as historical fact anywhere
//  in the product. Real historical fixtures (`source: "historical"` or
//  similar) are gated behind the unresolved legal/provenance question
//  tracked in CAGELAB_ROADMAP.md (Fight Card Daily Phase 2/2B findings)
//  and are NOT introduced here.
//
//  UNRESOLVED FOR LATER PHASE: how authoritative UTC-date -> fixture
//  assignment is generated without letting whichever client/deployment
//  happens to run first define the day's fixture. A UNIQUE(date)
//  constraint on a client-driven insert is NOT sufficient on its own --
//  it guarantees only one stored row, not that the row reflects a
//  server-authoritative choice, so a race between clients could still let
//  an arbitrary browser pick the day's fixture. Candidate approaches
//  (pre-populated assignments, a server/RPC-side assignment, or
//  deterministic assignment against an explicitly versioned immutable
//  published fixture pool) are deferred to a later phase. Nothing in this
//  file assumes or implements any of them -- there is no date logic, no
//  Supabase reference, and no `getDailyFixtureForDate`-style lookup here.
//
//  AUTHORING vs RUNTIME (fixture-immutability correction):
//  This module has NO import of and NO dependency on MASTER_FIGHTERS or
//  fighters.js. Every CardFighter below is a literal, hand-committed
//  snapshot -- displayName, appearanceId, division, and all 10 ratings
//  are typed directly into this file, not derived by looking anything up
//  at module-load time. MASTER_FIGHTERS was used only as an AUTHORING
//  SOURCE when these three development fixtures were originally put
//  together (see CAGELAB_ROADMAP.md's Phase A entry for the flow); that
//  authoring step is not, and must not become, part of this file. The
//  flow for a new or corrected fixture is:
//    MASTER_FIGHTERS (authoring source, mutable)
//      -> a human picks/copies the exact field values (authoring time)
//      -> literal CardFighter/Bout data committed to this file
//      -> frozen at runtime, read-only from here on
//  A future MASTER_FIGHTERS rating change can NEVER alter an already-
//  committed fixture revision (e.g. `card-2024-001-r1`) -- this file
//  simply has no path back to that data anymore. A correction to a
//  fixture's content is authored as a new revision (`-r2`, keeping `-r1`
//  byte-for-byte as committed), never an edit in place and never an
//  automatic regeneration.
// =========================================================================
import { SKILL_KEYS, WEIGHT_CLASSES } from "./attrs.js";

export const FIGHT_CARD_SCHEMA_VERSION = 1;

// The only source Phase A ever produces. Adding "historical"/"production"
// here is a later-phase, legal-gate-dependent decision -- do not add to
// this list casually.
export const FIGHT_CARD_SOURCES = ["development"];

// ---- literal CardFighter constructor -------------------------------
// Takes every field as a literal argument -- no lookup, no derivation, no
// dependency on any other fighter-data module. `attributes` is the exact
// committed snapshot for this fixture revision.
function cardFighter(id, displayName, appearanceId, division, attributes) {
  return Object.freeze({
    id,
    displayName,
    // The appearance id of the MASTER_FIGHTERS record this snapshot was
    // authored from, preserved as provenance metadata only. It is NOT a
    // live reference -- nothing reads MASTER_FIGHTERS by this id at
    // runtime, and it has no bearing on validation or gameplay.
    appearanceId,
    // Reserved for a future true cross-appearance/person identity.
    // Intentionally unimplemented in Phase A.
    personId: null,
    division,
    attributes: Object.freeze({ ...attributes }),
  });
}

function bout(order, division, fighterAId, fighterBId, status = "scheduled") {
  return Object.freeze({ order, division, fighterAId, fighterBId, status });
}

function fixture({ id, source, label, cardFighters, bouts }) {
  return Object.freeze({
    id,
    schemaVersion: FIGHT_CARD_SCHEMA_VERSION,
    source,
    label,
    cardFighters: Object.freeze(cardFighters),
    bouts: Object.freeze(bouts),
  });
}

// ---- Development fixture 1: single-division depth card ------------------
// A thick same-division pool -- 4 bouts, 8 distinct Lightweight/2010s
// fighters. Baseline case for later per-division pool-size logic.
const FIXTURE_LIGHTWEIGHT_DEPTH = fixture({
  id: "card-2024-001-r1",
  source: "development",
  label: "Development Fixture -- Lightweight Depth Card",
  cardFighters: [
    cardFighter("cf-2024-001-01", "Dustin Poirier", "dustin-poirier-lightweight-2010s", "Lightweight", { STRIKING: 92, GRAPPLING: 84, WRESTLING: 74, CARDIO: 83, POWER: 86, CHIN: 71, SPEED: 71, IQ: 65, HEIGHT: 69, REACH: 72 }),
    cardFighter("cf-2024-001-02", "James Krause", "james-krause-lightweight-2010s", "Lightweight", { STRIKING: 92, GRAPPLING: 84, WRESTLING: 66, CARDIO: 90, POWER: 74, CHIN: 72, SPEED: 73, IQ: 69, HEIGHT: 74, REACH: 73 }),
    cardFighter("cf-2024-001-03", "Dan Hooker", "dan-hooker-lightweight-2010s", "Lightweight", { STRIKING: 89, GRAPPLING: 77, WRESTLING: 72, CARDIO: 82, POWER: 85, CHIN: 73, SPEED: 69, IQ: 71, HEIGHT: 72, REACH: 75 }),
    cardFighter("cf-2024-001-04", "Donald Cerrone", "donald-cerrone-lightweight-2010s", "Lightweight", { STRIKING: 88, GRAPPLING: 70, WRESTLING: 76, CARDIO: 79, POWER: 87, CHIN: 62, SPEED: 67, IQ: 72, HEIGHT: 73, REACH: 73 }),
    cardFighter("cf-2024-001-05", "Rashid Magomedov", "rashid-magomedov-lightweight-2010s", "Lightweight", { STRIKING: 87, GRAPPLING: 62, WRESTLING: 81, CARDIO: 94, POWER: 77, CHIN: 85, SPEED: 82, IQ: 90, HEIGHT: 69, REACH: 70 }),
    cardFighter("cf-2024-001-06", "Tony Ferguson", "tony-ferguson-lightweight-2010s", "Lightweight", { STRIKING: 86, GRAPPLING: 71, WRESTLING: 66, CARDIO: 79, POWER: 70, CHIN: 66, SPEED: 67, IQ: 66, HEIGHT: 71, REACH: 76 }),
    cardFighter("cf-2024-001-07", "Khabib Nurmagomedov", "khabib-nurmagomedov-lightweight-2010s", "Lightweight", { STRIKING: 85, GRAPPLING: 91, WRESTLING: 95, CARDIO: 87, POWER: 65, CHIN: 93, SPEED: 90, IQ: 89, HEIGHT: 70, REACH: 70 }),
    cardFighter("cf-2024-001-08", "Gregor Gillespie", "gregor-gillespie-lightweight-2010s", "Lightweight", { STRIKING: 85, GRAPPLING: 91, WRESTLING: 95, CARDIO: 61, POWER: 87, CHIN: 83, SPEED: 92, IQ: 84, HEIGHT: 67, REACH: 71 }),
  ],
  bouts: [
    bout(1, "Lightweight", "cf-2024-001-07", "cf-2024-001-08"),
    bout(2, "Lightweight", "cf-2024-001-01", "cf-2024-001-02"),
    bout(3, "Lightweight", "cf-2024-001-03", "cf-2024-001-04"),
    bout(4, "Lightweight", "cf-2024-001-05", "cf-2024-001-06"),
  ],
});

// ---- Development fixture 2: cross-division card --------------------------
// 5 bouts, 5 different divisions, 2 fighters each -- exercises the
// "represented divisions" helper and multi-division bout ordering.
const FIXTURE_CROSS_DIVISION = fixture({
  id: "card-2024-002-r1",
  source: "development",
  label: "Development Fixture -- Cross-Division Card",
  cardFighters: [
    cardFighter("cf-2024-002-01", "Tom Aspinall", "tom-aspinall-heavyweight-2020s", "Heavyweight", { STRIKING: 99, GRAPPLING: 87, WRESTLING: 94, CARDIO: 64, POWER: 96, CHIN: 80, SPEED: 84, IQ: 73, HEIGHT: 77, REACH: 78 }),
    cardFighter("cf-2024-002-02", "Ciryl Gane", "ciryl-gane-heavyweight-2020s", "Heavyweight", { STRIKING: 97, GRAPPLING: 70, WRESTLING: 61, CARDIO: 85, POWER: 80, CHIN: 90, SPEED: 94, IQ: 74, HEIGHT: 76, REACH: 81 }),
    cardFighter("cf-2024-002-03", "Sean O'Malley", "sean-o-malley-bantamweight-2020s", "Bantamweight", { STRIKING: 98, GRAPPLING: 60, WRESTLING: 66, CARDIO: 87, POWER: 89, CHIN: 82, SPEED: 86, IQ: 72, HEIGHT: 71, REACH: 72 }),
    cardFighter("cf-2024-002-04", "Petr Yan", "petr-yan-bantamweight-2020s", "Bantamweight", { STRIKING: 95, GRAPPLING: 65, WRESTLING: 87, CARDIO: 95, POWER: 79, CHIN: 76, SPEED: 77, IQ: 80, HEIGHT: 67, REACH: 67 }),
    cardFighter("cf-2024-002-05", "Uros Medic", "uros-medic-welterweight-2020s", "Welterweight", { STRIKING: 95, GRAPPLING: 51, WRESTLING: 67, CARDIO: 76, POWER: 97, CHIN: 60, SPEED: 83, IQ: 63, HEIGHT: 73, REACH: 71 }),
    cardFighter("cf-2024-002-06", "Daniel Rodriguez", "daniel-rodriguez-welterweight-2020s", "Welterweight", { STRIKING: 93, GRAPPLING: 58, WRESTLING: 62, CARDIO: 94, POWER: 80, CHIN: 65, SPEED: 69, IQ: 70, HEIGHT: 73, REACH: 74 }),
    cardFighter("cf-2024-002-07", "Shara Magomedov", "shara-magomedov-middleweight-2020s", "Middleweight", { STRIKING: 98, GRAPPLING: 51, WRESTLING: 61, CARDIO: 96, POWER: 74, CHIN: 77, SPEED: 84, IQ: 80, HEIGHT: 74, REACH: 73 }),
    cardFighter("cf-2024-002-08", "Paulo Costa", "paulo-costa-middleweight-2020s", "Middleweight", { STRIKING: 98, GRAPPLING: 52, WRESTLING: 72, CARDIO: 88, POWER: 90, CHIN: 68, SPEED: 74, IQ: 70, HEIGHT: 73, REACH: 72 }),
    cardFighter("cf-2024-002-09", "Alexander Volkanovski", "alexander-volkanovski-featherweight-2020s", "Featherweight", { STRIKING: 97, GRAPPLING: 71, WRESTLING: 78, CARDIO: 94, POWER: 74, CHIN: 78, SPEED: 84, IQ: 80, HEIGHT: 66, REACH: 71 }),
    cardFighter("cf-2024-002-10", "Billy Quarantillo", "billy-quarantillo-featherweight-2020s", "Featherweight", { STRIKING: 96, GRAPPLING: 88, WRESTLING: 72, CARDIO: 91, POWER: 78, CHIN: 61, SPEED: 71, IQ: 63, HEIGHT: 70, REACH: 70 }),
  ],
  bouts: [
    bout(1, "Heavyweight", "cf-2024-002-01", "cf-2024-002-02"),
    bout(2, "Bantamweight", "cf-2024-002-03", "cf-2024-002-04"),
    bout(3, "Welterweight", "cf-2024-002-05", "cf-2024-002-06"),
    bout(4, "Middleweight", "cf-2024-002-07", "cf-2024-002-08"),
    bout(5, "Featherweight", "cf-2024-002-09", "cf-2024-002-10"),
  ],
});

// ---- Development fixture 3: thin-pool card --------------------------
// Mostly Welterweight (3 bouts, 6 fighters) plus a single Heavyweight
// outlier bout -- that division has only 2 card-fighters on this fixture,
// deliberately thin. Exists to give future target+adjacent-division
// physical-eligibility logic a realistic case where the exact-division
// pool already on the card is too small to draw from.
const FIXTURE_THIN_POOL = fixture({
  id: "card-2024-003-r1",
  source: "development",
  label: "Development Fixture -- Thin Pool Card",
  cardFighters: [
    cardFighter("cf-2024-003-01", "Jack Della Maddalena", "jack-della-maddalena-welterweight-2020s", "Welterweight", { STRIKING: 93, GRAPPLING: 58, WRESTLING: 63, CARDIO: 85, POWER: 87, CHIN: 64, SPEED: 76, IQ: 68, HEIGHT: 71, REACH: 73 }),
    cardFighter("cf-2024-003-02", "Rinat Fakhretdinov", "rinat-fakhretdinov-welterweight-2020s", "Welterweight", { STRIKING: 93, GRAPPLING: 80, WRESTLING: 90, CARDIO: 90, POWER: 74, CHIN: 81, SPEED: 80, IQ: 84, HEIGHT: 72, REACH: 72 }),
    cardFighter("cf-2024-003-03", "Geoff Neal", "geoff-neal-welterweight-2020s", "Welterweight", { STRIKING: 92, GRAPPLING: 65, WRESTLING: 77, CARDIO: 81, POWER: 92, CHIN: 63, SPEED: 70, IQ: 71, HEIGHT: 71, REACH: 75 }),
    cardFighter("cf-2024-003-04", "Carlos Prates", "carlos-prates-welterweight-2020s", "Welterweight", { STRIKING: 91, GRAPPLING: 52, WRESTLING: 76, CARDIO: 74, POWER: 97, CHIN: 76, SPEED: 76, IQ: 67, HEIGHT: 73, REACH: 78 }),
    cardFighter("cf-2024-003-05", "Sean Brady", "sean-brady-welterweight-2020s", "Welterweight", { STRIKING: 88, GRAPPLING: 90, WRESTLING: 94, CARDIO: 87, POWER: 55, CHIN: 86, SPEED: 88, IQ: 88, HEIGHT: 70, REACH: 72 }),
    cardFighter("cf-2024-003-06", "Gabriel Bonfim", "gabriel-bonfim-welterweight-2020s", "Welterweight", { STRIKING: 88, GRAPPLING: 79, WRESTLING: 90, CARDIO: 79, POWER: 65, CHIN: 77, SPEED: 75, IQ: 78, HEIGHT: 73, REACH: 72 }),
    cardFighter("cf-2024-003-07", "Alexander Volkov", "alexander-volkov-heavyweight-2020s", "Heavyweight", { STRIKING: 95, GRAPPLING: 62, WRESTLING: 76, CARDIO: 89, POWER: 77, CHIN: 83, SPEED: 88, IQ: 78, HEIGHT: 79, REACH: 80 }),
    cardFighter("cf-2024-003-08", "Parker Porter", "parker-porter-heavyweight-2020s", "Heavyweight", { STRIKING: 94, GRAPPLING: 74, WRESTLING: 71, CARDIO: 81, POWER: 61, CHIN: 52, SPEED: 70, IQ: 72, HEIGHT: 72, REACH: 75 }),
  ],
  bouts: [
    bout(1, "Welterweight", "cf-2024-003-01", "cf-2024-003-02"),
    bout(2, "Welterweight", "cf-2024-003-03", "cf-2024-003-04"),
    bout(3, "Welterweight", "cf-2024-003-05", "cf-2024-003-06"),
    bout(4, "Heavyweight", "cf-2024-003-07", "cf-2024-003-08"),
  ],
});

const FIGHT_CARD_FIXTURES = Object.freeze([
  FIXTURE_LIGHTWEIGHT_DEPTH,
  FIXTURE_CROSS_DIVISION,
  FIXTURE_THIN_POOL,
]);

// ---- Strict validator -----------------------------------------------
// No repair, no silent omission -- any of these fail the fixture outright.
const REQUIRED_ATTRIBUTE_KEYS = [...SKILL_KEYS, "HEIGHT", "REACH"];
const VALID_BOUT_STATUSES = ["scheduled"];

function validateFightCardFixture(fx) {
  const errors = [];
  if (!fx || typeof fx !== "object") return { valid: false, errors: ["fixture is not an object"] };
  const label = fx.id || "(missing id)";

  if (!fx.id || typeof fx.id !== "string") errors.push(`${label}: missing/invalid id`);
  if (fx.schemaVersion !== FIGHT_CARD_SCHEMA_VERSION) {
    errors.push(`${label}: unsupported schemaVersion "${fx.schemaVersion}"`);
  }
  if (!FIGHT_CARD_SOURCES.includes(fx.source)) errors.push(`${label}: unsupported source "${fx.source}"`);
  if (!fx.label || typeof fx.label !== "string") errors.push(`${label}: missing/invalid label`);

  const fighterIds = new Set();
  if (!Array.isArray(fx.cardFighters) || fx.cardFighters.length === 0) {
    errors.push(`${label}: cardFighters must be a non-empty array`);
  } else {
    fx.cardFighters.forEach((cf, i) => {
      const tag = `${label} cardFighters[${i}]`;
      if (!cf || !cf.id || typeof cf.id !== "string") { errors.push(`${tag}: missing/invalid id`); return; }
      if (fighterIds.has(cf.id)) errors.push(`${label}: duplicate cardFighter id "${cf.id}"`);
      fighterIds.add(cf.id);
      if (!cf.displayName) errors.push(`${tag} (${cf.id}): missing displayName`);
      if (!WEIGHT_CLASSES.includes(cf.division)) errors.push(`${tag} (${cf.id}): invalid division "${cf.division}"`);
      if (!cf.attributes || typeof cf.attributes !== "object") {
        errors.push(`${tag} (${cf.id}): missing attributes`);
      } else {
        REQUIRED_ATTRIBUTE_KEYS.forEach((k) => {
          if (typeof cf.attributes[k] !== "number" || !Number.isFinite(cf.attributes[k])) {
            errors.push(`${tag} (${cf.id}): missing/invalid attribute "${k}"`);
          }
        });
      }
    });
  }

  if (!Array.isArray(fx.bouts) || fx.bouts.length === 0) {
    errors.push(`${label}: bouts must be a non-empty array`);
  } else {
    const seenOrders = new Set();
    fx.bouts.forEach((b, i) => {
      const tag = `${label} bouts[${i}]`;
      if (!b || typeof b.order !== "number" || !Number.isInteger(b.order) || b.order < 1) {
        errors.push(`${tag}: invalid order "${b && b.order}"`);
      } else if (seenOrders.has(b.order)) {
        errors.push(`${label}: duplicate bout order ${b.order}`);
      } else {
        seenOrders.add(b.order);
      }
      if (!b || !WEIGHT_CLASSES.includes(b.division)) errors.push(`${tag}: invalid division "${b && b.division}"`);
      if (!b || !VALID_BOUT_STATUSES.includes(b.status)) errors.push(`${tag}: invalid status "${b && b.status}"`);
      if (!b || !fighterIds.has(b.fighterAId)) errors.push(`${tag}: fighterAId "${b && b.fighterAId}" not found in cardFighters`);
      if (!b || !fighterIds.has(b.fighterBId)) errors.push(`${tag}: fighterBId "${b && b.fighterBId}" not found in cardFighters`);
      if (b && b.fighterAId === b.fighterBId) errors.push(`${tag}: fighterAId and fighterBId are the same fighter`);
    });
  }

  return { valid: errors.length === 0, errors };
}

function assertValidFightCardFixture(fx) {
  const { valid, errors } = validateFightCardFixture(fx);
  if (!valid) {
    throw new Error(`Invalid Fight Card fixture "${fx && fx.id}":\n  - ${errors.join("\n  - ")}`);
  }
}

// Fail loudly at import time -- a broken fixture must never ship silently.
FIGHT_CARD_FIXTURES.forEach(assertValidFightCardFixture);
(function assertUniqueFixtureIds() {
  const seen = new Set();
  FIGHT_CARD_FIXTURES.forEach((fx) => {
    if (seen.has(fx.id)) throw new Error(`Duplicate Fight Card fixture id "${fx.id}"`);
    seen.add(fx.id);
  });
})();

// ---- Minimal read-only lookup API -----------------------------------
// Deliberately does NOT include date logic, a Daily-assignment lookup, or
// any Supabase reference -- see the UNRESOLVED note at the top of this file.
function getFightCardFixture(id) {
  return FIGHT_CARD_FIXTURES.find((fx) => fx.id === id) || null;
}

function listFightCardFixtures() {
  return FIGHT_CARD_FIXTURES;
}

function resolveFixture(fixtureOrId) {
  return typeof fixtureOrId === "string" ? getFightCardFixture(fixtureOrId) : fixtureOrId;
}

function getRepresentedDivisions(fixtureOrId) {
  const fx = resolveFixture(fixtureOrId);
  if (!fx) return [];
  return Array.from(new Set(fx.bouts.map((b) => b.division)));
}

function getCardFightersForDivision(fixtureOrId, division) {
  const fx = resolveFixture(fixtureOrId);
  if (!fx) return [];
  return fx.cardFighters.filter((cf) => cf.division === division);
}

export {
  FIGHT_CARD_FIXTURES,
  getCardFightersForDivision,
  getFightCardFixture,
  getRepresentedDivisions,
  listFightCardFixtures,
  validateFightCardFixture,
};
