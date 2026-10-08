import test from "node:test";
import assert from "node:assert/strict";

import { runDraftStrategyAudit } from "../scripts/draft-strategy-audit.mjs";

test("Draft Strategy audit is deterministic and uses the real combat contract", () => {
  const options = {
    contextCount: 8,
    opponentCount: 12,
    boardsPerCell: 3,
    boardsPerFixture: 5,
  };

  const first = runDraftStrategyAudit(options);
  const second = runDraftStrategyAudit(options);

  assert.deepEqual(first, second);
  assert.equal(first.structuralFindings.heightFeedsCombat, false);
  assert.equal(first.structuralFindings.reachFeedsCombat, true);
  assert.equal(first.structuralFindings.buildQualitiesAddHiddenBonus, false);
  assert.ok(first.methodology.contextCount > 0);
  assert.ok(first.methodology.opponentCount > 0);

  for (const key of Object.keys(first.boards.classic)) {
    assert.ok(first.boards.classic[key].boards > 0);
    assert.ok(first.boards.daily[key].boards > 0);
  }
});

test("full Draft Strategy baseline emits a reviewable summary", () => {
  const result = runDraftStrategyAudit();
  console.log("DRAFT_STRATEGY_AUDIT=" + JSON.stringify(result));
  assert.equal(result.physicals.height.combatDeltaShortToTall, 0);
  assert.ok(Number.isFinite(result.physicals.reach.averageCombatUtilityDeltaScore50To99));
  assert.ok(Number.isFinite(result.buildValue.rosterCorrelationWithSkillAverage));
});
