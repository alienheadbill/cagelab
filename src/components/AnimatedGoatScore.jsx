import React, { useState, useEffect } from "react";

// Counts the GOAT Score up from 0 on an ease-out curve. Skips straight to the
// final value under Reduced Motion instead of just being visually static --
// the wait itself is the thing being removed, not just the motion.
function AnimatedGoatScore({ score, reducedMotion }) {
  const [display, setDisplay] = useState(reducedMotion ? score : 0);
  useEffect(() => {
    if (reducedMotion) { setDisplay(score); return undefined; }
    let raf;
    const start = performance.now();
    const duration = 800;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * score));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [score, reducedMotion]);
  return display;
}

export default AnimatedGoatScore;
