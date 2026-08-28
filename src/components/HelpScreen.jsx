import React from "react";
import { ArrowLeft } from "lucide-react";
import { ATTRS } from "../data/attrs.js";

// ---------- Help screen ----------
function HelpScreen({ onBack }) {
  const items = [
    ["The Draft", "10 rounds, 10 attributes. Each round drops you into a random era + weight-class roster — pick one fighter to lend their rating to that attribute."],
    ["Classic vs Blind", "Classic shows every fighter's rating before you pick. Blind hides the numbers — you're drafting on reputation alone, with the full build revealed once the draft ends."],
    ["Daily Challenge", "One board a day, seeded by the date — everyone drafts the exact same rounds. No respins, one attempt, tracked with a streak."],
    ["Challenge Codes", "Create a code to draft a random board, then share it — a friend who enters that code drafts the identical board, no server required."],
    ["GOAT Score", "Rewards a high average across all 10 attributes, a bonus for elite (96+) ratings and a tight, balanced spread, and penalties for weak stats. 100 is vanishingly rare."],
    ["Camp Planning", "Once a year in Career Mode, pick a training focus, camp length, and stand-up/ground gameplan. Full camps are safer but mean fewer fights; short notice means more activity but more injury risk."],
    ["Fight Selection", "Sometimes the promotion offers a choice: an easy fight (safer, smaller reward) or stepping up in competition (riskier, bigger reward)."],
    ["Career Mode", "Live your build's career fight by fight — aging, injuries, rivalries, rankings, and a running Legacy Score that decides your final verdict."],
  ];
  return (
    <div className="panel">
      <div className="section-head-row">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="attr-name">How To Play</div>
      </div>
      {items.map(([title, text]) => (
        <div className="help-block" key={title}>
          <div className="help-title">{title}</div>
          <div className="help-text">{text}</div>
        </div>
      ))}
    </div>
  );
}

export default HelpScreen;
