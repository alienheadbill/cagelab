// Saved-build restoration is kept in a pure helper so Trophy Case reload
// behavior can be regression-tested without mounting the entire application.
//
// The saved record is the source of truth for build-owned metadata such as
// division. App-level draft state may be empty after a full page reload and
// must not overwrite that persisted value.
function restoreSavedBuildDraftState(build) {
  const restoredPicks = {};

  for (const pick of build?.picks || []) {
    if (!pick?.key) continue;

    const restored = {
      fighter: pick.fighter,
      display: pick.display,
      scoreValue: pick.scoreValue,
      raw: pick.raw,
    };

    // Fight Card Daily provenance is additive and may be absent on older
    // saves. Preserve it when present without making it required.
    if (pick.sourceCardFighterId !== undefined) {
      restored.sourceCardFighterId = pick.sourceCardFighterId;
    }

    restoredPicks[pick.key] = restored;
  }

  return {
    picks: restoredPicks,
    fighterName: build?.fighterName || "",
    mode: build?.mode || "classic",
    goatScore: build?.goatScore ?? null,
    division: build?.division || null,
    // Phase C identification provenance. Older builds predate this field and
    // legitimately restore null; never fabricate assignment metadata.
    dailyMeta: build?.dailyMeta || null,
  };
}

export { restoreSavedBuildDraftState };
