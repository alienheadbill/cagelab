// =========================================================================
//  PERSISTENCE (localStorage)
// =========================================================================
const LS_PREF_MODE = "cagelab_pref_mode";

const LS_DAILY_STATS = "cagelab_daily_stats";

const LS_SAVED_BUILDS = "cagelab_saved_builds";

const LS_CAREER_HISTORY = "cagelab_career_history";

const LS_DARK_MODE = "cagelab_dark_mode";

const LS_SOUND_ON = "cagelab_sound_on";

const LS_REDUCED_MOTION = "cagelab_reduced_motion";

const LS_DAILY_LOG = "cagelab_daily_log";

const LS_DISPLAY_NAME = "cagelab_display_name";

// Onboarding: has this browser ever reached the home screen before, and has
// it already seen the one-time draft-screen hint. Two separate flags on
// purpose -- a player can see the home screen without ever starting a
// draft, so the draft hint needs to persist independently of "have they
// been here before."
const LS_HAS_VISITED = "cagelab_has_visited";

const LS_SEEN_DRAFT_HINT = "cagelab_seen_draft_hint";

// Active Career Save + Resume V1: the one in-progress Career, so refreshing
// or closing the tab doesn't lose it -- distinct from LS_CAREER_HISTORY
// above, which only ever holds COMPLETED careers. V1 is a single slot: one
// active Career at a time, no cloud sync, no multiple saves. The value
// stored here is a versioned envelope (see ACTIVE_CAREER_SAVE_VERSION) --
// App.jsx owns validating/migrating/normalizing its contents; this module
// only owns the raw key and the byte-level read/write/clear.
const LS_ACTIVE_CAREER = "cagelab_active_career";

// Wrapper-format version for the LS_ACTIVE_CAREER envelope -- deliberately
// separate from careerState.universe.schemaVersion (Persistent Universe
// Foundation V1's own concern: the shape of the universe data). This one
// versions the SAVE ENVELOPE itself ({ version, savedAt, careerState, ui }),
// so the two can evolve independently -- a future envelope-format change
// (e.g. adding a new `ui` field) doesn't need to touch the universe schema,
// and vice versa.
const ACTIVE_CAREER_SAVE_VERSION = 1;

function loadJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

// Returns true/false so a caller that cares (Active Career Save, chiefly)
// can tell whether the write actually landed -- e.g. localStorage full or
// unavailable (private browsing, quota exceeded). Every EXISTING caller
// already discards the return value, so this is purely additive: nothing
// that ignored the old implicit `undefined` return breaks by now getting a
// real boolean instead. Still fails silently either way -- the app keeps
// running on in-memory state regardless; only a caller that explicitly
// checks the result can react to a failed write.
function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // localStorage unavailable/full -- fail silently, app still works this session
    return false;
  }
}

// Deliberately its own tiny helper rather than `saveJSON(LS_ACTIVE_CAREER,
// null)` -- removeItem, not a stored `null` value, so a corrupt-save
// safety check reading this key back later sees "nothing here" (the
// loadJSON fallback) rather than a present-but-null envelope it would then
// have to special-case.
function clearActiveCareer() {
  try {
    window.localStorage.removeItem(LS_ACTIVE_CAREER);
  } catch (e) {
    // localStorage unavailable -- nothing to clean up either way
  }
}

const defaultDailyStats = { bestScore: 0, currentStreak: 0, bestStreak: 0, lastCompletedDate: null, lastScore: null };

// =========================================================================
//  EXPORT / IMPORT
// =========================================================================
function exportAllData() {
  const payload = {
    // Bumped 1 -> 2: adds `activeCareer` below. Purely additive -- every
    // field from version 1 is still present in the same shape, so an
    // older CageLab build reading a version-2 export would still recover
    // everything it understands; only a build from BEFORE this pass
    // wouldn't recognize the new field (and would simply ignore it, same
    // as any importer already does for keys it doesn't know about).
    version: 2,
    prefMode: loadJSON(LS_PREF_MODE, "classic"),
    dailyStats: loadJSON(LS_DAILY_STATS, defaultDailyStats),
    savedBuilds: loadJSON(LS_SAVED_BUILDS, []),
    careerHistory: loadJSON(LS_CAREER_HISTORY, []),
    dailyLog: loadJSON(LS_DAILY_LOG, []),
    // The one in-progress Career, if any -- same raw envelope shape
    // LS_ACTIVE_CAREER already holds (version/savedAt/careerState/ui).
    // null when there is no active Career, same as every other
    // "nothing saved yet" case in this payload.
    activeCareer: loadJSON(LS_ACTIVE_CAREER, null),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cagelab-data.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importAllData(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.prefMode) saveJSON(LS_PREF_MODE, data.prefMode);
      if (data.dailyStats) saveJSON(LS_DAILY_STATS, data.dailyStats);
      if (data.savedBuilds) saveJSON(LS_SAVED_BUILDS, data.savedBuilds);
      if (data.careerHistory) saveJSON(LS_CAREER_HISTORY, data.careerHistory);
      if (data.dailyLog) saveJSON(LS_DAILY_LOG, data.dailyLog);
      // Absent entirely on a pre-version-2 export -- backward-compatible by
      // construction, same `if present` convention as every field above.
      // Written through unchanged, exactly like every other field here: it
      // goes through the SAME validate/migrate/normalize pipeline as any
      // other active save the next time the app loads (see App.jsx's
      // loadPersistedActiveCareer), rather than a second incompatible
      // loader living here.
      if (data.activeCareer) saveJSON(LS_ACTIVE_CAREER, data.activeCareer);
      onDone(true);
    } catch (e) {
      onDone(false);
    }
  };
  reader.readAsText(file);
}

export {
  ACTIVE_CAREER_SAVE_VERSION,
  LS_ACTIVE_CAREER,
  LS_CAREER_HISTORY,
  LS_DAILY_LOG,
  LS_DAILY_STATS,
  LS_DARK_MODE,
  LS_DISPLAY_NAME,
  LS_HAS_VISITED,
  LS_PREF_MODE,
  LS_REDUCED_MOTION,
  LS_SAVED_BUILDS,
  LS_SEEN_DRAFT_HINT,
  LS_SOUND_ON,
  clearActiveCareer,
  defaultDailyStats,
  exportAllData,
  importAllData,
  loadJSON,
  saveJSON,
};
