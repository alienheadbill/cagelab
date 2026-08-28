import React, { useState, useEffect, useRef } from "react";
import { WEIGHT_CLASSES, CLASS_PHYSICALS, erasForClass } from "../data/attrs.js";
import { rosterFor } from "../data/fighters.js";
import { formatHeight, formatReach } from "../lib/utils.js";
import { sfx } from "../lib/audio.js";

// ---------- Division roll: your weight class is drawn, not chosen ----------
// Rolls through the divisions slot-machine style and lands on one. Choosing it
// felt like paperwork before the game started; drawing it makes the division
// something you react to and build around.
function DivisionRollPanel({ onSettled, reducedMotion }) {
  const [display, setDisplay] = useState(WEIGHT_CLASSES[0]);
  const [settled, setSettled] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const final = WEIGHT_CLASSES[Math.floor(Math.random() * WEIGHT_CLASSES.length)];
    if (reducedMotion) {
      setDisplay(final);
      setSettled(final);
      const t = setTimeout(() => onSettled(final), 350);
      return () => clearTimeout(t);
    }
    const delays = [60, 65, 70, 80, 95, 115, 140, 175, 215, 265, 330];
    let i = 0;
    const tick = () => {
      setDisplay(WEIGHT_CLASSES[Math.floor(Math.random() * WEIGHT_CLASSES.length)]);
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
  const pool = settled
    ? erasForClass(shown).reduce((n, era) => n + rosterFor(shown, era).length, 0)
    : null;

  return (
    <div className="panel division-roll-panel">
      <div className="result-eyebrow mono">YOUR DIVISION</div>
      <div className={`division-roll-name display ${settled ? "settled" : "rolling"}`}>{shown}</div>
      {settled ? (
        <div className="division-roll-meta mono">
          {pool} fighters &middot; avg {formatHeight(Math.round(phys.ht))} / {formatReach(Math.round(phys.rc))} reach
        </div>
      ) : (
        <div className="division-roll-meta mono">Drawing your weight class&hellip;</div>
      )}
      {settled && <div className="division-roll-sub">Every round drafts from this division. Era rotates each round.</div>}
    </div>
  );
}

export default DivisionRollPanel;
