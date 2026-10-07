import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchDailyLeaderboard,
  fetchTodayDailyAssignment,
  submitDailyScore,
} from "../src/lib/supabase.js";

const DAILY_META = {
  challengeDate: "2026-10-07",
  fixtureId: "card-2024-001-r1",
  rulesVersion: "fight-card-v1",
};

test("Daily authority RPC uses POST and the publishable key only as apikey", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => [{
        challenge_date: DAILY_META.challengeDate,
        fixture_id: DAILY_META.fixtureId,
        rules_version: DAILY_META.rulesVersion,
        seed: 1210255544,
      }],
    };
  };

  try {
    const result = await fetchTodayDailyAssignment();

    assert.equal(result.ok, true);
    assert.ok(request.url.endsWith("/rest/v1/rpc/get_today_daily_assignment"));
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.body, "{}");
    assert.equal(request.options.headers["Content-Type"], "application/json");
    assert.match(request.options.headers.apikey, /^sb_publishable_/);
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(result.assignment.fixture_id, DAILY_META.fixtureId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Daily authority transport fails closed on HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  try {
    assert.deepEqual(await fetchTodayDailyAssignment(), {
      ok: false,
      reason: "http",
      status: 503,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Daily authority transport fails closed on network errors and empty responses", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.deepEqual(await fetchTodayDailyAssignment(), {
      ok: false,
      reason: "network",
    });

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    });
    assert.deepEqual(await fetchTodayDailyAssignment(), {
      ok: false,
      reason: "empty",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Daily score submission references the exact authoritative assignment RPC", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200 };
  };

  try {
    assert.deepEqual(
      await submitDailyScore(DAILY_META, 91, "  Test Fighter  "),
      { ok: true }
    );

    assert.ok(request.url.endsWith("/rest/v1/rpc/submit_daily_score"));
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.Authorization, undefined);

    const body = JSON.parse(request.options.body);
    assert.deepEqual(body, {
      p_challenge_date: DAILY_META.challengeDate,
      p_fixture_id: DAILY_META.fixtureId,
      p_rules_version: DAILY_META.rulesVersion,
      p_score: 91,
      p_display_name: "  Test Fighter  ",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Daily score submission refuses to fabricate missing assignment identity", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not fetch");
  };

  try {
    assert.deepEqual(
      await submitDailyScore(null, 90, "Nobody"),
      { ok: false, reason: "missing-assignment" }
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Daily leaderboard reads through the exact-assignment RPC", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  const rows = [
    { display_name: "Alpha", score: 99, created_at: "2026-10-07T20:00:00Z" },
    { display_name: "Beta", score: 95, created_at: "2026-10-07T20:01:00Z" },
  ];

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => rows,
    };
  };

  try {
    assert.deepEqual(await fetchDailyLeaderboard(DAILY_META, 200), rows);
    assert.ok(request.url.endsWith("/rest/v1/rpc/get_daily_leaderboard"));
    assert.equal(request.options.method, "POST");

    const body = JSON.parse(request.options.body);
    assert.deepEqual(body, {
      p_challenge_date: DAILY_META.challengeDate,
      p_fixture_id: DAILY_META.fixtureId,
      p_rules_version: DAILY_META.rulesVersion,
      p_limit: 200,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Daily leaderboard degrades to empty on missing identity, HTTP failure, or network failure", async () => {
  const originalFetch = globalThis.fetch;

  try {
    assert.deepEqual(await fetchDailyLeaderboard(null, 20), []);

    globalThis.fetch = async () => ({ ok: false, status: 400 });
    assert.deepEqual(await fetchDailyLeaderboard(DAILY_META, 20), []);

    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.deepEqual(await fetchDailyLeaderboard(DAILY_META, 20), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
