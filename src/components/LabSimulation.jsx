import React, { useState } from "react";
import { Swords } from "lucide-react";
import { SKILL_KEYS } from "../data/attrs.js";
import { resolveFight, deriveTraits } from "../lib/career.js";
import { archetypeFor } from "../lib/scoring.js";
import { flatAttrsFromPicks } from "../lib/lab.js";
import FightResultCard from "./FightResultCard.jsx";

// The same "average of the 8 skill ratings" convention already used
// everywhere else in the game for a displayed OVR (see
// generateOpponentProfile / prepareFight's playerOverallNow in career.js)
// -- reused here purely for the corner display, never fed into
// resolveFight itself, and not a new scoring formula.
function overallFor(picks) {
  const sum = SKILL_KEYS.reduce((s, k) => s + picks[k].scoreValue, 0);
  return Math.round(sum / SKILL_KEYS.length);
}

// Runs ONE real fight through the exact same engine Career Mode uses.
// player/opp, reach, and traits are all freshly read from each fighter's
// current picks at call time -- nothing is cached or mutated, and
// resolveFight itself is already a pure function with no side effects (it
// writes nothing to rank, record, or history -- see commitFight, which
// this never calls). Neutral stance (0) and 3 rounds, the same defaults a
// non-title Career fight uses -- The Lab has no stance or title concept of
// its own to feed in.
function runSimulation(fighterA, fighterB) {
  const attrsA = flatAttrsFromPicks(fighterA.picks);
  const attrsB = flatAttrsFromPicks(fighterB.picks);
  const traitsA = deriveTraits(attrsA);
  const traitsB = deriveTraits(attrsB);
  const result = resolveFight(attrsA, fighterA.picks.REACH.scoreValue, attrsB, 0, traitsA, traitsB, 3);
  return {
    ...result,
    labSim: true,
    opp: fighterB.name,
    oppRating: overallFor(fighterB.picks),
    playerOverall: overallFor(fighterA.picks),
    archetype: archetypeFor(fighterB.picks),
    playerTraits: traitsA,
  };
}

// A fresh "Run Simulation" click always calls resolveFight again -- same
// function, so the same real randomness Career fights use is preserved
// (not seeded, not forced deterministic for the Lab's sake). Nothing here
// is persisted: closing or reloading the Lab loses the result, same as
// every other piece of Lab state.
function LabSimulation({ fighterA, fighterB }) {
  const [result, setResult] = useState(null);
  const [runCount, setRunCount] = useState(0);
  // The combat engine has no body-weight/reach-differential model between
  // divisions -- a Flyweight vs Heavyweight "simulation" would just be two
  // ordinary rating sets run through the same math, which would misrepresent
  // itself as a real fight. Comparison/editing stays cross-division; only
  // running an actual fight is gated on matching divisions. No new
  // weight-difference math is added anywhere -- this is a UI gate only.
  const sameDivision = fighterA.division === fighterB.division;

  function handleSimulate() {
    if (!sameDivision) return;
    setResult(runSimulation(fighterA, fighterB));
    setRunCount((c) => c + 1);
  }

  return (
    <div className="panel lab-simulation">
      <div className="collection-block-title">Fight Simulation</div>
      <div className="help-text lab-sim-intro">
        Runs the exact same fight engine Career Mode uses. This result isn't saved and never affects a career, ranking, or record.
      </div>
      {sameDivision ? (
        <button className="btn btn-primary" onClick={handleSimulate}>
          <Swords size={16} /> {result ? "Run Again" : "Simulate Fight"}
        </button>
      ) : (
        <div className="lab-sim-disabled-note help-text">
          Match divisions to simulate a fight. {fighterA.name} is {fighterA.division}, {fighterB.name} is {fighterB.division} -- the fight engine doesn't model weight differences between classes.
        </div>
      )}
      {result && (
        <div className="lab-sim-result" key={runCount}>
          <FightResultCard e={result} playerName={fighterA.name} />
        </div>
      )}
    </div>
  );
}

export default LabSimulation;
