import React, { useEffect, useState } from "react";
import AnimatedGoatScore from "./AnimatedGoatScore.jsx";

// Classic mode's GOAT Score hero number is just the final tally of ratings
// the player already saw all draft long -- it can appear immediately.
// Blind mode is different: the player has been picking on reputation
// alone, so this number is genuinely new information, the first real look
// at the fighter they actually built. A brief obscured beat before it pops
// into the normal animated count-up gives that moment its own small
// discovery beat -- restrained on purpose, one extra beat reusing the
// existing popIn language, not a new animation system.
function BlindGoatReveal({ score, reducedMotion }) {
  const [revealed, setRevealed] = useState(reducedMotion);
  useEffect(() => {
    if (reducedMotion) return undefined;
    const t = setTimeout(() => setRevealed(true), 450);
    return () => clearTimeout(t);
  }, [reducedMotion]);

  if (!revealed) {
    return <div className="result-goat-num display blind-goat-obscured mono">??</div>;
  }
  return (
    <div className="result-goat-num display blind-goat-revealed">
      <AnimatedGoatScore score={score} reducedMotion={reducedMotion} />
    </div>
  );
}

export default BlindGoatReveal;
