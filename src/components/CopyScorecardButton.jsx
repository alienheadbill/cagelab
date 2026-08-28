import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { sfx } from "../lib/audio.js";

function CopyScorecardButton({ text, label = "Copy Scorecard" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-ghost"
      onClick={() => {
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
        sfx("select");
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied!" : label}
    </button>
  );
}

export default CopyScorecardButton;
