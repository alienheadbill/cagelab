import {
  Swords, Hand, Dumbbell, HeartPulse, Flame, ShieldCheck, Zap, Brain,
  Ruler, ArrowLeftRight,
} from "lucide-react";

// ---------- Attributes ----------
const ATTRS = [
  { key: "STRIKING", label: "Striking", abbr: "STR", icon: Swords, kind: "skill" },
  { key: "GRAPPLING", label: "Grappling", abbr: "GRA", icon: Hand, kind: "skill" },
  { key: "WRESTLING", label: "Wrestling", abbr: "WRE", icon: Dumbbell, kind: "skill" },
  { key: "CARDIO", label: "Cardio", abbr: "CAR", icon: HeartPulse, kind: "skill" },
  { key: "POWER", label: "Power", abbr: "POW", icon: Flame, kind: "skill" },
  { key: "CHIN", label: "Chin", abbr: "CHN", icon: ShieldCheck, kind: "skill" },
  { key: "SPEED", label: "Speed", abbr: "SPD", icon: Zap, kind: "skill" },
  { key: "IQ", label: "Fight IQ", abbr: "IQ", icon: Brain, kind: "skill" },
  { key: "HEIGHT", label: "Height", abbr: "HGT", icon: Ruler, kind: "height" },
  { key: "REACH", label: "Reach", abbr: "RCH", icon: ArrowLeftRight, kind: "reach" },
];

const ATTR_BY_KEY = Object.fromEntries(ATTRS.map((a) => [a.key, a]));

const SKILL_KEYS = ["STRIKING", "GRAPPLING", "WRESTLING", "CARDIO", "POWER", "CHIN", "SPEED", "IQ"];

// When drafting one attribute, these are the 1-2 related attributes shown as
// mini context bars on each fighter card (mirrors GOAT Lab's related-stat cue).
const RELATED_ATTRS = {
  STRIKING: ["POWER", "SPEED"],
  GRAPPLING: ["WRESTLING", "CARDIO"],
  WRESTLING: ["GRAPPLING", "CARDIO"],
  CARDIO: ["IQ", "CHIN"],
  POWER: ["STRIKING", "CHIN"],
  CHIN: ["CARDIO", "POWER"],
  SPEED: ["STRIKING", "IQ"],
  IQ: ["CARDIO", "CHIN"],
  HEIGHT: ["REACH"],
  REACH: ["HEIGHT"],
};

const WEIGHT_CLASSES = [
  "Flyweight", "Bantamweight", "Featherweight", "Lightweight",
  "Welterweight", "Middleweight", "Light Heavyweight", "Heavyweight",
];

function erasForClass(wc) {
  return ["Flyweight", "Bantamweight", "Featherweight"].includes(wc)
    ? ["2010s", "2020s"]
    : ["2000s", "2010s", "2020s"];
}

// ---- Weight-class-relative Height & Reach ----
// A 6'3" lightweight is a giant; the same frame on a heavyweight is short.
// These score height/reach against the midpoint of the class the fighter
// actually competed in, rather than a single flat scale across all classes.
const CLASS_PHYSICALS = {
  Flyweight: { ht: 65.5, rc: 66.5 },
  Bantamweight: { ht: 66.5, rc: 67.5 },
  Featherweight: { ht: 67.5, rc: 69.0 },
  Lightweight: { ht: 69.0, rc: 70.5 },
  Welterweight: { ht: 70.5, rc: 72.5 },
  Middleweight: { ht: 72.0, rc: 74.0 },
  "Light Heavyweight": { ht: 73.5, rc: 75.5 },
  Heavyweight: { ht: 75.5, rc: 78.0 },
};

export {
  ATTRS,
  ATTR_BY_KEY,
  CLASS_PHYSICALS,
  RELATED_ATTRS,
  SKILL_KEYS,
  WEIGHT_CLASSES,
  erasForClass,
};
