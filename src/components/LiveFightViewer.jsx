import React, { useEffect, useMemo, useRef, useState } from "react";
import { FastForward } from "lucide-react";
import { buildPlaybackScript, momentumToPercent, beatDurationMs } from "../lib/fightPlayback.js";
import { sfx } from "../lib/audio.js";

// ---------- Live Fight Viewer: watch the fight happen, round by round ----------
// A single playback of an ALREADY-COMPLETE fight result. resolveFight (see
// career.js) has already decided everything -- who wins each round, the
// finish, the narrative text, the fight moments -- before this component
// ever mounts. This only sequences that existing data with timed pacing; it
// never calls back into the engine and never re-rolls anything. Same
// "resolve first, animate after" separation DivisionRollPanel already uses
// for the Daily weight reveal.
//
// Plays once, ahead of the existing static FightResultCard (which is left
// completely unchanged and still renders immediately after this finishes
// or is skipped) -- see App.jsx's spotlight block.
function LiveFightViewer({
  rounds, roundNarratives, moments, win,
  playerName, oppName, reducedMotion, onDone,
}) {
  const { beats, fightArcMoments } = useMemo(
    () => buildPlaybackScript(rounds, roundNarratives, moments),
    [rounds, roundNarratives, moments]
  );
  // -1 = not started, 0..beats.length-1 = that beat showing, beats.length =
  // showing the whole-fight arc moments (if any), beyond that = done.
  const [step, setStep] = useState(-1);
  const [flash, setFlash] = useState(false);
  const timerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const doneRef = useRef(false);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }

  useEffect(() => {
    clearTimeout(timerRef.current);
    clearTimeout(flashTimerRef.current);
    // Defensive: this component should never be mounted with reducedMotion
    // true (App.jsx gates that), but if it somehow is, skip straight to the
    // existing static reveal rather than show a half-built meter -- same
    // "the wait itself is the thing being removed" rule AnimatedGoatScore/
    // DivisionRollPanel already follow.
    if (reducedMotion || beats.length === 0) { finish(); return undefined; }

    let i = 0;
    const advance = () => {
      if (i >= beats.length) {
        if (fightArcMoments.length > 0) {
          setStep(beats.length);
          timerRef.current = setTimeout(finish, 1800);
        } else {
          finish();
        }
        return;
      }
      setStep(i);
      const beat = beats[i];
      if (beat.finishThisRound) { sfx("bell"); sfx(win ? "win" : "loss"); }
      else sfx("bell");
      if (beat.flipped) {
        setFlash(true);
        flashTimerRef.current = setTimeout(() => setFlash(false), 600);
      }
      timerRef.current = setTimeout(() => { i += 1; advance(); }, beatDurationMs(beat));
    };
    advance();
    return () => { clearTimeout(timerRef.current); clearTimeout(flashTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reducedMotion || beats.length === 0) return null;

  const showingArc = step === beats.length;
  const beat = !showingArc && step >= 0 ? beats[step] : null;
  const pct = beat ? momentumToPercent(beat.momentum) : 50;
  const leaningPlayer = pct >= 50;
  // Player reads on the left, opponent on the right (see .live-fight-names
  // below) -- so a player-favoring fill must grow LEFTWARD from the center
  // line (toward the player's name), and an opponent-favoring fill
  // RIGHTWARD (toward the opponent's), not just change color in place.
  const fillWidth = Math.abs(pct - 50);
  const fillLeft = leaningPlayer ? 50 - fillWidth : 50;

  return (
    <div className="panel live-fight-viewer">
      <div className="result-eyebrow mono">LIVE</div>

      <div className="live-fight-names">
        <span className="live-fight-name you">{playerName}</span>
        <span className="live-fight-vs mono">vs</span>
        <span className="live-fight-name opp">{oppName}</span>
      </div>

      <div className="momentum-meter">
        <div className="momentum-track">
          <div className="momentum-center-line" />
          {beat && (
            <div
              className={`momentum-fill ${leaningPlayer ? "you" : "opp"} intensity-${beat.intensity} ${flash ? "flip-flash" : ""}`}
              style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
            />
          )}
        </div>
      </div>

      <div className="round-tracker live-round-tracker">
        {beats.map((b, i) => (
          <div
            key={b.round}
            className={`round-pip ${i < step || (i === step && b.finishThisRound) ? (b.playerWon ? "you" : "opp") : ""} ${i === step ? "current" : i > step ? "pending" : ""} ${b.finishThisRound && i <= step ? "finish" : ""}`}
          >
            R{b.round}
          </div>
        ))}
      </div>

      {beat && (
        <div className="stat-compare-grid live-fatigue-damage">
          <div className="stat-compare-row">
            <b>{Math.round((beat.playerFatigue / 0.4) * 100)}%</b><span>Fatigue</span><b>{Math.round((beat.oppFatigue / 0.4) * 100)}%</b>
          </div>
          <div className="stat-compare-row">
            <b>{Math.min(100, Math.round(beat.playerDamage))}</b><span>Damage Absorbed</span><b>{Math.min(100, Math.round(beat.oppDamage))}</b>
          </div>
        </div>
      )}

      <div className="live-fight-caption">
        {showingArc ? (
          <div className="fight-moments">
            {fightArcMoments.map((m, i) => (
              <div className={`fight-moment moment-${m.type}`} key={i}>
                <div className="fight-moment-label mono">{m.label}</div>
                <div className="fight-moment-text">{m.text}</div>
              </div>
            ))}
          </div>
        ) : beat ? (
          <div className={`round-narrative-row ${beat.playerWon ? "you" : "opp"} ${beat.finishThisRound ? "finish" : ""}`}>
            <div className="round-narrative-head mono">
              ROUND {beat.round}{beat.finishThisRound ? " — FINISH" : ""}
            </div>
            <div className="round-narrative-text">{beat.narrative}</div>
            {beat.moments.length > 0 && (
              <div className="fight-moments">
                {beat.moments.map((m, i) => (
                  <div className={`fight-moment moment-${m.type}`} key={i}>
                    <div className="fight-moment-label mono">{m.label}</div>
                    <div className="fight-moment-text">{m.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <button className="btn btn-ghost live-fight-skip" onClick={finish}>
        <FastForward size={14} /> Skip
      </button>
    </div>
  );
}

export default LiveFightViewer;
