// ---------- Seeded RNG for Daily Challenge + friend Challenge Codes ----------
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromDateStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr() { return dateStr(new Date()); }

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStr(d);
}

// Challenge codes are just a base-36 encoding of the RNG seed -- fully
// client-side, no server needed. Two players entering the same code get the
// exact same 10-round board.
function encodeSeed(seedNum) { return Math.abs(seedNum).toString(36).toUpperCase(); }

function decodeSeed(code) {
  const n = parseInt(String(code).trim(), 36);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export {
  dateStr,
  decodeSeed,
  encodeSeed,
  mulberry32,
  seedFromDateStr,
  shuffle,
  todayStr,
  yesterdayStr,
};
