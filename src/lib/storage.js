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

function loadJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // localStorage unavailable -- fail silently, app still works this session
  }
}

const defaultDailyStats = { bestScore: 0, currentStreak: 0, bestStreak: 0, lastCompletedDate: null, lastScore: null };

// =========================================================================
//  EXPORT / IMPORT
// =========================================================================
function exportAllData() {
  const payload = {
    version: 1,
    prefMode: loadJSON(LS_PREF_MODE, "classic"),
    dailyStats: loadJSON(LS_DAILY_STATS, defaultDailyStats),
    savedBuilds: loadJSON(LS_SAVED_BUILDS, []),
    careerHistory: loadJSON(LS_CAREER_HISTORY, []),
    dailyLog: loadJSON(LS_DAILY_LOG, []),
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
      onDone(true);
    } catch (e) {
      onDone(false);
    }
  };
  reader.readAsText(file);
}

export {
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
  defaultDailyStats,
  exportAllData,
  importAllData,
  loadJSON,
  saveJSON,
};
