// =========================================================================
//  BACKEND: Supabase leaderboards (Daily Challenge + Challenge Codes)
//  Uses the public REST endpoint directly with fetch -- no SDK, no build
//  step. The anon/publishable key is safe to ship client-side; it's scoped
//  by the Row Level Security policies on the Supabase project, not secrecy.
//  Leaderboard calls remain failure-tolerant, but Daily authority is
//  deliberately different: fetchTodayDailyAssignment returns an explicit
//  failure so App can fail CLOSED instead of inventing a local competitive
//  Daily when the authoritative RPC is unavailable.
// =========================================================================
const SUPABASE_URL = "https://inceyzopygadykbllkza.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_NoPnoIxZFoobCjO2HTjhcg_iptkWE-1";

const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function supabaseHeaders(extra) {
  return {
    // The project uses Supabase's modern sb_publishable_* key format. Those
    // keys are opaque API keys, not JWTs, so they belong on `apikey`, not
    // Authorization: Bearer.
    apikey: SUPABASE_ANON_KEY,
    ...extra,
  };
}

async function fetchTodayDailyAssignment() {
  if (!SUPABASE_ENABLED) return { ok: false, reason: "disabled" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_today_daily_assignment`, {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json" }),
      body: "{}",
    });
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const payload = await res.json();
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row) return { ok: false, reason: "empty" };
    return { ok: true, assignment: row };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

async function submitDailyScore(date, score, displayName) {
  if (!SUPABASE_ENABLED) return { ok: false, reason: "disabled" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_scores`, {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ date, score, display_name: (displayName || "Anonymous").slice(0, 24) }),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

async function fetchDailyLeaderboard(date, limit) {
  if (!SUPABASE_ENABLED) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/daily_scores?date=eq.${date}&select=display_name,score,created_at&order=score.desc,created_at.asc&limit=${limit || 20}`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function submitChallengeScore(code, score, displayName) {
  if (!SUPABASE_ENABLED) return { ok: false, reason: "disabled" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/challenge_scores`, {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ code, score, display_name: (displayName || "Anonymous").slice(0, 24) }),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

async function fetchChallengeLeaderboard(code, limit) {
  if (!SUPABASE_ENABLED || !code) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/challenge_scores?code=eq.${encodeURIComponent(code)}&select=display_name,score,created_at&order=score.desc,created_at.asc&limit=${limit || 20}`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

export {
  SUPABASE_ENABLED,
  fetchChallengeLeaderboard,
  fetchDailyLeaderboard,
  fetchTodayDailyAssignment,
  submitChallengeScore,
  submitDailyScore,
};
