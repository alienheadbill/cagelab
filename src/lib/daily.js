const DAILY_RULES_VERSION = "fight-card-v1";
const DAILY_RULES_VERSION_ONE_USE_SOURCE = "fight-card-v2";
const SUPPORTED_DAILY_RULES_VERSIONS = new Set([
  DAILY_RULES_VERSION,
  DAILY_RULES_VERSION_ONE_USE_SOURCE,
]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// One-attempt-per-authoritative-Daily policy.
//
// Phase C deliberately takes the date as input instead of reading the device
// clock here. The caller must pass the UTC challengeDate returned by the
// server assignment. Missing authority means "unavailable", never "today"
// guessed from the browser.
function dailyAttemptState(stats, date) {
  if (!date) return "unavailable";
  if (stats?.lastCompletedDate === date) return "completed";
  if (stats?.attemptedDate === date) return "attempted";
  return "available";
}

function canStartDaily(stats, date) {
  return dailyAttemptState(stats, date) === "available";
}

function isCanonicalIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

// Converts the snake_case RPC row into the client contract and rejects stale
// or malformed authority rather than allowing the caller to invent a
// fallback. Supported rules versions are explicit because changing Daily
// board semantics must never silently mutate an already-published version.
function normalizeDailyAssignment(row) {
  if (!row || typeof row !== "object") {
    return { ok: false, reason: "missing-assignment" };
  }

  const challengeDate = row.challenge_date;
  const fixtureId = row.fixture_id;
  const rulesVersion = row.rules_version;
  const seed = row.seed;

  if (!isCanonicalIsoDate(challengeDate)) {
    return { ok: false, reason: "invalid-date" };
  }
  if (typeof fixtureId !== "string" || fixtureId.trim() === "") {
    return { ok: false, reason: "invalid-fixture" };
  }
  if (!SUPPORTED_DAILY_RULES_VERSIONS.has(rulesVersion)) {
    return { ok: false, reason: "unsupported-rules", rulesVersion };
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483646) {
    return { ok: false, reason: "invalid-seed" };
  }

  return {
    ok: true,
    assignment: {
      challengeDate,
      fixtureId,
      rulesVersion,
      seed,
    },
  };
}

// Streak arithmetic must follow the authoritative UTC Daily date, not the
// local timezone. Parse/format in UTC so DST and local midnight never enter
// the calculation.
function previousIsoDate(date) {
  if (!isCanonicalIsoDate(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day) - 86400000);
  return previous.toISOString().slice(0, 10);
}

function dailyUsesOneUseSource(rulesVersion) {
  return rulesVersion === DAILY_RULES_VERSION_ONE_USE_SOURCE;
}

export {
  DAILY_RULES_VERSION,
  DAILY_RULES_VERSION_ONE_USE_SOURCE,
  dailyUsesOneUseSource,
  canStartDaily,
  dailyAttemptState,
  isCanonicalIsoDate,
  normalizeDailyAssignment,
  previousIsoDate,
};
