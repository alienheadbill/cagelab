import { Crown, Star, Diamond, Circle } from "lucide-react";

// Colorblind-safe: tier is conveyed by icon shape as well as color, never color alone.
function TierIcon({ cls, size = 12 }) {
  if (cls === "tier-legend") return <Crown size={size} />;
  if (cls === "tier-gold") return <Star size={size} />;
  if (cls === "tier-silver") return <Diamond size={size} />;
  return <Circle size={size} />;
}

export default TierIcon;
