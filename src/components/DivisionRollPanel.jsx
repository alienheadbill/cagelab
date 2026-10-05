import React, { useState, useEffect, useRef } from "react";
import { WEIGHT_CLASSES, CLASS_PHYSICALS, erasForClass } from "../data/attrs.js";
import { rosterFor } from "../data/fighters.js";
import { formatHeight, formatReach } from "../lib/utils.js";
import { sfx } from "../lib/audio.js";

// ---------- Division roll: your weight class is drawn, not chosen ----------
// Rolls through the divisions slot-machine style and lands on one. Choosing it
// felt like paperwork before the game started; drawing it makes the division
// something you react to and build around.
//
// Fight Card Daily V2 Phase B reuses this same reveal for the late
// weight-class roll (after skill pick #8, before Height) via four
// additive props, all optional and defaulting to the original Classic/
// Blind pre-draft behavior unchanged:
// - `finalOverride`: the already-resolved division to animate toward,
//   instead of drawing one internally with Math.random. The REAL decision
//   (resolveLateWeight, on the deterministic Daily rng) always happens
//   before this component ever mounts -- it only ever animates toward a
//   value it's handed, never re-derives or re-rolls one of its own.
// - `candidatesOverride`: restricts the cosmetic cycling to this list of
//   divisions (e.g. the fixture's represented divisions) instead of all
//   WEIGHT_CLASSES -- purely cosmetic, never affects the outcome.
// - `eyebrow`/`settledLabel`: text overrides for the two fixed strings
//   that otherwise describe "a fresh division for a whole new build"
//   (wrong framing for "your skills are already locked, weight is next").
// - `metaNode`: replaces the settled meta line. The default line counts
//   real MASTER_FIGHTERS roster size for the division, which would be a
//   false "this fixture has N fighters" claim for Fight Card Daily --
//   callers reusing this for a fixture pass their own node instead.
function DivisionRollPanel({
  onSettled, reducedMotion, finalOverride, candidatesOverride,
  eyebrow = "YOUR DIVISION", settledLabel = "Every round drafts from this division. Era rotates each round.",
  metaNode,
}) {
  const candidates = candidatesOverride && candidatesOverride.length ? candidatesOverride : WEIGHT_CLASSES;
  const [display, setDisplay] = useState(candidates[0]);
  const [settled, setSettled] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const final = finalOverride || candidates[Math.floor(Math.random() * candidates.length)];
    if (reducedMotion) {
      setDisplay(final);
      setSettled(final);
      const t = setTimeout(() => onSettled(final), 350);
      return () => clearTimeout(t);
    }
    const delays = [60, 65, 70, 80, 95, 115, 140, 175, 215, 265, 330];
    let i = 0;
    const tick = () => {
      setDisplay(candidates[Math.floor(Math.random() * candidates.length)]);
      if (i < delays.length - 1) {
        i += 1;
        timerRef.current = setTimeout(tick, delays[i]);
      } else {
        setDisplay(final);
        setSettled(final);
        sfx("whoosh");
        timerRef.current = setTimeout(() => onSettled(final), 900);
      }
    };
    tick();
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = settled || display;
  const phys = CLASS_PHYSICALS[shown];
  const pool = settled && !metaNode
    ? erasForClass(shown).reduce((n, era) => n + rosterFor(shown, era).length, 0)
    : null;

  return (
    <div className="panel division-roll-panel">
      <div className="result-eyebrow mono">{eyebrow}</div>
      <div className={`division-roll-name display ${settled ? "settled" : "rolling"}`}>{shown}</div>
      {settled ? (
        metaNode || (
          <div className="division-roll-meta mono">
            {pool} fighters &middot; avg {formatHeight(Math.round(phys.ht))} / {formatReach(Math.round(phys.rc))} reach
          </div>
        )
      ) : (
        <div className="division-roll-meta mono">Drawing your weight class&hellip;</div>
      )}
      {settled && <div className="division-roll-sub">{settledLabel}</div>}
    </div>
  );
}

export default DivisionRollPanel;
