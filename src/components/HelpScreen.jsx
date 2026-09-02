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
    ["Build Value", "How dangerous this build's actual game is, separate from how complete it is. A specialist can have a high Build Value and a modest GOAT Score."],
    ["Archetype", "The fighting identity your attribute spread adds up to, with a primary weapon, a secondary weapon, and a liability."],
    ["The Lab", "A sandbox for testing builds and Legacy fighters outside of Career — edit freely, nothing here touches your real progress."],
    ["My Legacy", "Every finished career, saved as a permanent record: peak rank, division, GOAT Score, and how it ended."],
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

      <div className="disclaimer-block">
        <div className="disclaimer-title">About This Project</div>
        <p>
          CageLab is an unofficial fan project. It is not affiliated with, endorsed by, or
          associated with the UFC, Zuffa, TKO Group, or any fighter, promotion, or organization.
          All trademarks belong to their respective owners.
        </p>
        <p>
          Fighter names and physical measurements (height, reach) are real and drawn from public
          records. The eight skill ratings are <b>not</b> official numbers from any published
          source &mdash; they are derived from public UFC fight statistics as percentile ranks
          within the fighter population. Striking, Grappling, Wrestling, Cardio, Chin and Power
          come from real per-fight data; Speed and Fight IQ are indirect inferences from accuracy
          and defensive statistics, not direct measurements.
        </p>
        <p>
          Career Mode opponents, records, rankings and events are entirely fictional and
          procedurally generated. No real fighter&apos;s record is ever affected or represented.
        </p>
        <p className="disclaimer-credit">
          Fight statistics derived from publicly available data via UFC-DataLab (MIT licensed).
        </p>
      </div>
    </div>
  );
}

export default HelpScreen;