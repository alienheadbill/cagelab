// =========================================================================
//  EVENT ARCHIVE + FIGHTER HISTORIES V1 -- read-model / decoder layer
//  Pure, read-only presentation helpers over the canonical universe/archive
//  data World Movement + Bout Ledger V1 / Universe Events V1 already
//  produce. Nothing here simulates a fight, mutates state, or invents
//  history -- it only reads and reshapes what's already true.
// =========================================================================
import { PLAYER_BOUT_ID, orderBoutsForCard, eventNumberKeyFor, clfTier } from "./career.js";

// ---- Completed-Career compact archive: constants + encoder -------------
// Moved here verbatim from App.jsx (Pre-PR Realism & Archive Hardening /
// Universe Events V1) -- same format, same versions, just relocated
// alongside the new decoder so the whole encode/decode contract for this
// data lives in one place. App.jsx imports buildUniverseArchive from here
// unchanged; saveCareerToHistory's own behavior is byte-for-byte identical.
export const UNIVERSE_ARCHIVE_V1_CIRCUITS = ["CLF Regional", "CLF National", "CLF PREMIER", "CLF Contender Series"];
// Verified exhaustive against career.js (both the lightweight NPC
// resolver's 3 values and the player's own full combat resolver's win/
// loss variants of all 3) via a round-trip archive test -- a future new
// method string in career.js needs a version:2 table, not a silent edit
// of this one.
export const UNIVERSE_ARCHIVE_V1_METHODS = ["Decision", "Decision Loss", "KO/TKO", "KO/TKO Loss", "Submission", "Submission Loss"];
export const UNIVERSE_ARCHIVE_V1_PLAYER_IDX = -1;
export const UNIVERSE_ARCHIVE_V1_NO_CHAMPION = -2;
// Universe Events V1: "vacated" is the only transition `type` this pass
// ever produces, so `type` itself is not encoded per-entry -- a
// version:3 that ever needs a second type gets its own table.
export const UNIVERSE_ARCHIVE_V2_TRANSITION_REASONS = ["promotion", "contenderSeries", "weightMove", "retirement"];

export function buildUniverseArchive(careerState) {
  if (!careerState.universe) return null;
  const bouts = careerState.universe.bouts || [];
  const fighterIndex = new Map(); // original string id -> dictionary index
  const fighters = []; // [id, name, archetype]
  function indexFor(id, name, archetype) {
    if (fighterIndex.has(id)) return fighterIndex.get(id);
    const idx = fighters.length;
    fighters.push([id, name, archetype ?? null]);
    fighterIndex.set(id, idx);
    return idx;
  }
  const referencedIds = new Set();
  bouts.forEach((b) => {
    if (b.fighterAId !== PLAYER_BOUT_ID) referencedIds.add(b.fighterAId);
    if (b.fighterBId !== PLAYER_BOUT_ID) referencedIds.add(b.fighterBId);
  });
  Object.values(careerState.universe.divisions).forEach((division) => {
    division.forEach((f) => { if (referencedIds.has(f.id)) indexFor(f.id, f.name, f.archetype); });
  });
  bouts.forEach((b) => {
    if (b.opponentName && !fighterIndex.has(b.fighterBId)) indexFor(b.fighterBId, b.opponentName, b.opponentArchetype || null);
  });
  Object.entries(careerState.universe.historicalFighterIdentities || {}).forEach(([id, nameArchetype]) => {
    if (referencedIds.has(id) && !fighterIndex.has(id)) indexFor(id, nameArchetype[0], nameArchetype[1]);
  });
  function fighterIdxFor(id) {
    if (id === PLAYER_BOUT_ID) return UNIVERSE_ARCHIVE_V1_PLAYER_IDX;
    return fighterIndex.has(id) ? fighterIndex.get(id) : indexFor(id, null, null);
  }
  function rankCode(rank) { return rank == null ? -1 : rank; }
  function championBeforeCode(championBeforeId) {
    if (championBeforeId == null) return UNIVERSE_ARCHIVE_V1_NO_CHAMPION;
    return fighterIdxFor(championBeforeId);
  }
  const divisionIndex = new Map();
  const divisions = [];
  function divisionIdxFor(name) {
    const key = name ?? "";
    if (divisionIndex.has(key)) return divisionIndex.get(key);
    const idx = divisions.length;
    divisions.push(key);
    divisionIndex.set(key, idx);
    return idx;
  }
  const boutIndexById = new Map();
  const compactBouts = bouts.map((b, i) => {
    boutIndexById.set(b.id, i);
    const circuitCode = Math.max(0, UNIVERSE_ARCHIVE_V1_CIRCUITS.indexOf(b.circuit));
    const methodCode = Math.max(0, UNIVERSE_ARCHIVE_V1_METHODS.indexOf(b.method));
    const winnerSide = b.winnerId === b.fighterAId ? 0 : 1;
    return [
      b.year, b.worldTick, circuitCode,
      fighterIdxFor(b.fighterAId), fighterIdxFor(b.fighterBId),
      winnerSide, methodCode, b.round, b.titleFight ? 1 : 0,
      championBeforeCode(b.championBeforeId),
      rankCode(b.rankABefore), rankCode(b.rankBBefore),
      b.recordABefore.w, b.recordABefore.l, b.recordBBefore.w, b.recordBBefore.l,
    ];
  });
  const compactEvents = (careerState.universe.events || []).map((ev) => {
    const circuitCode = Math.max(0, UNIVERSE_ARCHIVE_V1_CIRCUITS.indexOf(ev.circuit));
    const boutIndices = ev.boutIds.map((id) => boutIndexById.get(id)).filter((i) => i != null);
    return [ev.year, ev.worldTick, circuitCode, divisionIdxFor(ev.division), ev.eventNumber, boutIndices];
  });
  const compactTitleTransitions = (careerState.universe.titleTransitions || []).map((t) => {
    const circuitCode = Math.max(0, UNIVERSE_ARCHIVE_V1_CIRCUITS.indexOf(t.circuit));
    const reasonCode = Math.max(0, UNIVERSE_ARCHIVE_V2_TRANSITION_REASONS.indexOf(t.reason));
    return [t.worldTick, t.year, circuitCode, divisionIdxFor(t.division), fighterIdxFor(t.championId), reasonCode];
  });
  return {
    version: 2,
    fighters, divisions,
    bouts: compactBouts,
    events: compactEvents,
    titleTransitions: compactTitleTransitions,
  };
}

// ---- Decoder -------------------------------------------------------------
// Turns a stored archive (version 1 or 2) back into plain bout/event/
// transition objects, shaped exactly like the live universe's own
// bouts/events/titleTransitions so downstream read-model code never has
// to care which source it came from. Player identity is intentionally
// NOT stored in the archive (see buildUniverseArchive's own history) --
// Player identity is deliberately never embedded here (see
// buildUniverseArchive's own comment) -- callers resolve PLAYER_BOUT_ID
// from their own sibling data (the Career History entry's own
// fighterName) via their own resolveFighter, not from this function.
export function decodeUniverseArchive(archive) {
  if (!archive || (archive.version !== 1 && archive.version !== 2)) return { bouts: [], events: [], titleTransitions: [], fighters: new Map() };
  const fighterMap = new Map(); // id -> { name, archetype }
  (archive.fighters || []).forEach(([id, name, archetype]) => fighterMap.set(id, { name, archetype }));
  const idxToId = (idx) => (idx === UNIVERSE_ARCHIVE_V1_PLAYER_IDX ? PLAYER_BOUT_ID : (archive.fighters[idx] ? archive.fighters[idx][0] : `unknown-${idx}`));

  const bouts = (archive.bouts || []).map((t, i) => {
    const [year, worldTick, circuitCode, aIdx, bIdx, winnerSide, methodCode, round, titleFlag, champCode, rankA, rankB, wA, lA, wB, lB] = t;
    const aId = idxToId(aIdx), bId = idxToId(bIdx);
    return {
      id: `bout-${i + 1}`, year, worldTick,
      circuit: UNIVERSE_ARCHIVE_V1_CIRCUITS[circuitCode],
      // No `division` set here on purpose -- a compact bout tuple never
      // repeats it (only its owning EVENT carries the weight class, once
      // per card rather than once per bout); propagated down from the
      // owning event further below, after events are decoded/derived.
      fighterAId: aId, fighterBId: bId,
      winnerId: winnerSide === 0 ? aId : bId,
      method: UNIVERSE_ARCHIVE_V1_METHODS[methodCode], round,
      titleFight: !!titleFlag,
      championBeforeId: champCode === UNIVERSE_ARCHIVE_V1_NO_CHAMPION ? null : idxToId(champCode),
      rankABefore: rankA === -1 ? null : rankA, rankBBefore: rankB === -1 ? null : rankB,
      recordABefore: { w: wA, l: lA }, recordBBefore: { w: wB, l: lB },
    };
  });

  let events = [];
  let derived = false;
  if (archive.version === 2 && Array.isArray(archive.events)) {
    events = archive.events.map(([year, worldTick, circuitCode, divCode, eventNumber, boutIndices]) => ({
      circuit: UNIVERSE_ARCHIVE_V1_CIRCUITS[circuitCode], division: archive.divisions ? archive.divisions[divCode] : undefined,
      year, worldTick, eventNumber,
      boutIds: boutIndices.map((i) => `bout-${i + 1}`),
      derived: false,
    }));
  } else {
    // Version 1 (or missing events): no persisted event identity exists.
    // Section 10 of the underlying task: the SAME grouping rule Universe
    // Events V1's own #38-era migration already uses (worldTick + circuit,
    // same orderBoutsForCard priority) deterministically recovers which
    // bouts belonged on the same card and in what order -- that's real,
    // reconstructible history, not a guess. Event NUMBERS are recovered
    // the same deterministic way (this IS how native migration derives
    // them too). Marked `derived: true` so the UI can honestly label
    // these as reconstructed rather than implying they were always
    // persisted this way.
    derived = true;
    const byTickCircuit = new Map();
    bouts.forEach((b) => {
      const key = `${b.worldTick}::${b.circuit}`;
      if (!byTickCircuit.has(key)) byTickCircuit.set(key, []);
      byTickCircuit.get(key).push(b);
    });
    const eventNumbers = { regional: 0, national: 0, premier: 0, contenderSeries: 0 };
    byTickCircuit.forEach((group) => {
      const { circuit, worldTick, year } = group[0];
      const key = eventNumberKeyFor(circuit);
      eventNumbers[key] += 1;
      events.push({
        circuit, division: undefined, year, worldTick,
        eventNumber: eventNumbers[key],
        boutIds: orderBoutsForCard(group).map((b) => b.id),
        derived: true,
      });
    });
  }

  const titleTransitions = archive.version === 2 ? (archive.titleTransitions || []).map(([worldTick, year, circuitCode, divCode, champIdx, reasonCode]) => ({
    type: "vacated",
    circuit: UNIVERSE_ARCHIVE_V1_CIRCUITS[circuitCode], division: archive.divisions ? archive.divisions[divCode] : undefined,
    worldTick, year,
    championId: idxToId(champIdx),
    reason: UNIVERSE_ARCHIVE_V2_TRANSITION_REASONS[reasonCode],
  })) : [];

  // A V2 compact bout tuple never repeats `division` (only its owning
  // EVENT carries it, to avoid storing the same weight-class string once
  // per bout instead of once per card) -- propagate it down here so every
  // decoded bout still carries its own historical division, exactly like
  // a live universe bout already does. For a V1 archive the event's own
  // division is itself still undefined at this point (V1 never recorded
  // one at all) -- getCompletedCareerEventArchive backfills that single
  // remaining gap from the Career History entry's own final division.
  const eventByBoutId = new Map();
  events.forEach((ev) => ev.boutIds.forEach((bid) => eventByBoutId.set(bid, ev)));
  const boutsWithDivision = bouts.map((b) => {
    const owningEvent = eventByBoutId.get(b.id);
    return { ...b, division: owningEvent ? owningEvent.division : undefined };
  });

  return { bouts: boutsWithDivision, events, titleTransitions, fighterMap, derived };
}

// ---- Normalized read-model: ACTIVE career -------------------------------
// Turns a live careerState.universe into the SAME shape decodeUniverseArchive
// produces, so getEventDisplayModel/getFighterHistory never need to know
// which source they're reading. Purely reads -- never mutates universe.
export function getActiveUniverseHistory(universe, playerName) {
  if (!universe) return null;
  function resolveFighter(id) {
    if (id === PLAYER_BOUT_ID) return { id, name: playerName, archetype: null, isPlayer: true };
    for (const division of Object.values(universe.divisions || {})) {
      const f = division.find((x) => x.id === id);
      if (f) return { id, name: f.name, archetype: f.archetype, isPlayer: false };
    }
    const hist = universe.historicalFighterIdentities && universe.historicalFighterIdentities[id];
    if (hist) return { id, name: hist[0], archetype: hist[1], isPlayer: false, isHistorical: true };
    const csBout = (universe.bouts || []).find((b) => b.opponentName && (b.fighterAId === id || b.fighterBId === id));
    if (csBout) return { id, name: csBout.opponentName, archetype: csBout.opponentArchetype || null, isPlayer: false, isCS: true };
    return { id, name: id, archetype: null, isPlayer: false, unresolved: true };
  }
  return {
    bouts: universe.bouts || [],
    events: universe.events || [],
    titleTransitions: universe.titleTransitions || [],
    resolveFighter,
    source: "active",
  };
}

// ---- Normalized read-model: COMPLETED career (Career History entry) -----
// entry is one LS_CAREER_HISTORY item -- reads entry.universeArchive
// (version 1 or 2) plus entry.fighterName/entry.division for the two
// facts the archive deliberately never duplicates (player identity, and
// -- for a V1 archive only -- the one weight class every one of its
// bouts is guaranteed to have happened in).
export function getCompletedCareerEventArchive(entry) {
  if (!entry || !entry.universeArchive) return null;
  const decoded = decodeUniverseArchive(entry.universeArchive);
  // Backfill `division` for a V1 archive (see decodeUniverseArchive's own
  // comment) -- provably the Career's one weight class, never a guess.
  const bouts = decoded.bouts.map((b) => (b.division !== undefined ? b : { ...b, division: entry.division || null }));
  const events = decoded.events.map((e) => (e.division !== undefined ? e : { ...e, division: entry.division || null }));
  function resolveFighter(id) {
    if (id === PLAYER_BOUT_ID) return { id, name: entry.fighterName, archetype: null, isPlayer: true };
    const f = decoded.fighterMap.get(id);
    if (f) return { id, name: f.name, archetype: f.archetype, isPlayer: false };
    return { id, name: id, archetype: null, isPlayer: false, unresolved: true };
  }
  return {
    bouts, events, titleTransitions: decoded.titleTransitions,
    resolveFighter,
    source: "completed",
    archiveVersion: entry.universeArchive.version,
  };
}

// ---- Event display model --------------------------------------------------
// Decorates one event with resolved fighter names/labels for each of its
// bouts, in PERSISTED order (never re-sorted by current anything).
export function getEventDisplayModel(event, history) {
  const boutById = new Map(history.bouts.map((b) => [b.id, b]));
  const bouts = event.boutIds.map((bid, i) => {
    const b = boutById.get(bid);
    if (!b) return null;
    const a = history.resolveFighter(b.fighterAId);
    const bb = history.resolveFighter(b.fighterBId);
    const winnerIsA = b.winnerId === b.fighterAId;
    let titleContext = null;
    if (b.titleFight) titleContext = b.championBeforeId == null ? "vacant" : "defense";
    return {
      cardPosition: i,
      boutId: b.id,
      a: { ...a, rankBefore: b.rankABefore, recordBefore: b.recordABefore, won: winnerIsA },
      b: { ...bb, rankBefore: b.rankBBefore, recordBefore: b.recordBBefore, won: !winnerIsA },
      method: b.method, round: b.round, titleFight: b.titleFight, titleContext,
    };
  }).filter(Boolean);
  const t = clfTier(event.circuit);
  return {
    ...event,
    circuitShort: t.short,
    label: event.eventNumber != null ? `${t.short} ${event.eventNumber}` : "LEGACY EVENT",
    bouts,
  };
}

// ---- Fighter history -------------------------------------------------------
// Walks EVERY bout in `history.bouts` involving fighterId, newest first,
// deriving: tracked record (baseline "entered tracking" record + ledger
// W/L, NOT the same as "total career record" -- see Section 25 of the
// underlying task, generated fighters begin universe life with a
// synthetic pre-tracking record), peak observed rank, and the full
// event-linked fight list.
export function getFighterHistory(history, fighterId) {
  const identity = history.resolveFighter(fighterId);
  const eventByBoutId = new Map();
  history.events.forEach((ev) => ev.boutIds.forEach((bid) => eventByBoutId.set(bid, ev)));

  const appearances = history.bouts
    .filter((b) => b.fighterAId === fighterId || b.fighterBId === fighterId)
    .sort((a, b) => a.worldTick - b.worldTick); // chronological ascending for baseline/peak derivation

  let peakRank = null; // 0 = champion (best); lower number = better; null = never observed ranked
  const fightsChronological = appearances.map((b) => {
    const isA = b.fighterAId === fighterId;
    const myRankBefore = isA ? b.rankABefore : b.rankBBefore;
    const myRecordBefore = isA ? b.recordABefore : b.recordBBefore;
    const oppId = isA ? b.fighterBId : b.fighterAId;
    const oppRankBefore = isA ? b.rankBBefore : b.rankABefore;
    const oppRecordBefore = isA ? b.recordBBefore : b.recordABefore;
    const win = b.winnerId === fighterId;
    if (myRankBefore != null && (peakRank == null || myRankBefore < peakRank)) peakRank = myRankBefore;
    const ev = eventByBoutId.get(b.id);
    return {
      boutId: b.id, win, method: b.method, round: b.round, titleFight: b.titleFight,
      titleContext: b.titleFight ? (b.championBeforeId == null ? "vacant" : (b.championBeforeId === fighterId ? "defense" : "challenge")) : null,
      myRankBefore, myRecordBefore, oppId, oppRankBefore, oppRecordBefore,
      opponent: history.resolveFighter(oppId),
      circuit: b.circuit, division: b.division, year: b.year, worldTick: b.worldTick,
      event: ev ? { id: ev.eventNumber != null ? `${clfTier(ev.circuit).short} ${ev.eventNumber}` : "LEGACY EVENT", circuit: ev.circuit, eventNumber: ev.eventNumber, derived: !!ev.derived } : null,
    };
  });

  const trackedFightCount = fightsChronological.length;
  const trackedW = fightsChronological.filter((f) => f.win).length;
  const trackedL = trackedFightCount - trackedW;
  const baselineRecord = trackedFightCount ? fightsChronological[0].myRecordBefore : null;
  const finalOrCurrentRecord = baselineRecord ? { w: baselineRecord.w + trackedW, l: baselineRecord.l + trackedL } : null;

  return {
    id: fighterId,
    name: identity.name, archetype: identity.archetype, isPlayer: !!identity.isPlayer,
    isCS: !!identity.isCS, isHistorical: !!identity.isHistorical, unresolved: !!identity.unresolved,
    trackedFightCount, trackedRecord: { w: trackedW, l: trackedL },
    baselineRecord, finalOrCurrentRecord,
    peakRank,
    peakRankLabel: peakRank === 0 ? "Champion" : peakRank != null ? `#${peakRank}` : "Unranked",
    // Newest first for browsing (Section 35).
    fights: [...fightsChronological].reverse(),
  };
}

// ---- Top-level event list, newest first ------------------------------------
export function listEventsNewestFirst(history, circuitFilter) {
  const events = circuitFilter && circuitFilter !== "ALL"
    ? history.events.filter((ev) => ev.circuit === circuitFilter)
    : history.events;
  return [...events].sort((a, b) => (b.worldTick - a.worldTick) || (b.eventNumber ?? 0) - (a.eventNumber ?? 0));
}
