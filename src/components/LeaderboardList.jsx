import React from "react";
import { Loader2 } from "lucide-react";
import { SUPABASE_ENABLED } from "../lib/supabase.js";

// ---------- Home screen ----------
// ---------- Live leaderboard list (Supabase-backed, gracefully degrades) ----------
function LeaderboardList({ entries, loading, emptyText }) {
  if (loading) {
    return (
      <div className="leaderboard-status mono">
        <Loader2 size={13} className="spin-icon" /> Loading leaderboard&hellip;
      </div>
    );
  }
  if (!SUPABASE_ENABLED) {
    return <div className="leaderboard-status mono">Online leaderboard not configured.</div>;
  }
  if (!entries || entries.length === 0) {
    return <div className="leaderboard-status mono">{emptyText || "No scores yet — be the first!"}</div>;
  }
  return (
    <div className="leaderboard-list">
      {entries.map((e, i) => (
        <div className="leaderboard-row" key={`${e.display_name}-${e.created_at}-${i}`}>
          <div className="leaderboard-rank mono">#{i + 1}</div>
          <div className="leaderboard-name">{e.display_name || "Anonymous"}</div>
          <div className="leaderboard-score mono">{e.score}</div>
        </div>
      ))}
    </div>
  );
}

export default LeaderboardList;
