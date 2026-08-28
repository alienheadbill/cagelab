import { LS_SOUND_ON, loadJSON } from "./storage.js";

// =========================================================================
//  SOUND (synthesized with Web Audio -- no external audio files needed)
// =========================================================================
let sharedAudioCtx = null;

function getAudioCtx() {
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

function playTone(freq, duration, type, volume, startDelay) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const t0 = ctx.currentTime + (startDelay || 0);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function sfx(kind) {
  if (loadJSON(LS_SOUND_ON, false) !== true) return;
  try {
    if (kind === "select") playTone(520, 0.08, "triangle", 0.06, 0);
    else if (kind === "win") { playTone(440, 0.12, "triangle", 0.08, 0); playTone(660, 0.16, "triangle", 0.07, 0.08); }
    else if (kind === "loss") { playTone(220, 0.22, "sawtooth", 0.06, 0); playTone(160, 0.28, "sawtooth", 0.05, 0.05); }
    else if (kind === "bell") { playTone(880, 0.5, "sine", 0.07, 0); playTone(880, 0.5, "sine", 0.05, 0.15); }
    else if (kind === "whoosh") playTone(300, 0.3, "sine", 0.04, 0);
  } catch (e) { /* audio unavailable */ }
}

export {
  sfx,
};
