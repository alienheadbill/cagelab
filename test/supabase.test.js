import test from "node:test";
import assert from "node:assert/strict";

import { fetchTodayDailyAssignment } from "../src/lib/supabase.js";

test("Daily authority RPC uses POST and the publishable key only as apikey", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => [{
        challenge_date: "2026-10-07",
        fixture_id: "card-2024-001-r1",
        rules_version: "fight-card-v1",
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
    assert.equal(result.assignment.fixture_id, "card-2024-001-r1");
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
