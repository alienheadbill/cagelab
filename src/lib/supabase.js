// =========================================================================
//  BACKEND: Supabase leaderboards (Daily Challenge + Challenge Codes)
//  Uses the public REST endpoint directly with fetch -- no SDK, no build
//  step. The anon/publishable key is safe to ship client-side; it's scoped
//  by the Row Level Security policies on the Supabase project, not secrecy.
//  Every call is wrapped so a missing table, no network, or a misconfigured
//  key just silently falls back to local-only play -- it never breaks the
//  offline experience.
// =========================================================================
const SUPABASE_URL = "https://inceyzopygadykbllkza.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_NoPnoIxZFoobCjO2HTjhcg_iptkWE-1";

const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function supabaseHeaders(extra) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
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
  submitChallengeScore,
  submitDailyScore,
};
