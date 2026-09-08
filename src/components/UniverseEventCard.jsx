import React from "react";
import { Crown, Swords } from "lucide-react";

// One bout row inside an event-detail card. Fight-night truth only --
// rankBefore/recordBefore, never anything read off current live state.
// Fighter names are real buttons (keyboard accessible), never a
// clickable <div>.
function rankChip(rankBefore) {
  if (rankBefore === 0) return "C";
  if (rankBefore == null) return "Unranked";
  return `#${rankBefore}`;
}

function BoutSide({ side, onOpenFighter }) {
  const label = side.isPlayer ? `${side.name} (You)` : side.name;
  return (
    <div className={`ue-bout-side ${side.won ? "won" : ""}`}>
      <button
        type="button"
        className="ue-fighter-name-btn"
        onClick={() => onOpenFighter(side.id)}
        aria-label={`Open fight history for ${side.name}`}
      >
        {label}
      </button>
      <div className="ue-bout-side-meta mono">
        {rankChip(side.rankBefore)} &middot; {side.recordBefore.w}-{side.recordBefore.l}
      </div>
    </div>
  );
}

const PROMINENCE_LABEL = { main: "MAIN EVENT", comain: "CO-MAIN", featured: "FEATURED", undercard: null };

function BoutRow({ bout, onOpenFighter, prominence }) {
  const posLabel = PROMINENCE_LABEL[prominence];
  return (
    <div className={`ue-bout-row ue-bout-${prominence}`}>
      <div className="ue-bout-eyebrow mono">
        {posLabel && <span className="ue-bout-position">{posLabel}</span>}
        {bout.titleFight && (
          <span className="ue-bout-title-flag">
            <Crown size={11} /> {bout.titleContext === "vacant" ? "VACANT TITLE" : "TITLE FIGHT"}
          </span>
        )}
      </div>
      <div className="ue-bout-matchup">
        <BoutSide side={bout.a} onOpenFighter={onOpenFighter} />
        <div className="ue-bout-vs mono">VS</div>
        <BoutSide side={bout.b} onOpenFighter={onOpenFighter} />
      </div>
      <div className="ue-bout-result mono">
        {(bout.a.won ? bout.a.name : bout.b.name)} wins &middot; {bout.method} &middot; R{bout.round}
      </div>
    </div>
  );
}

// Card hierarchy (Section 14-16): boutIds[0] is always the main event,
// boutIds[1] the co-main -- never recomputed from current rankings, the
// order itself IS the historical fact. Bouts beyond the first ~5 are
// collapsed behind an explicit expand control rather than dropped.
const FEATURED_COUNT = 5;

function UniverseEventCard({ event, onOpenFighter, expanded, onExpand }) {
  const bouts = event.bouts;
  const featured = bouts.slice(0, FEATURED_COUNT);
  const rest = bouts.slice(FEATURED_COUNT);

  return (
    <div className="ue-card">
      <div className="ue-card-head">
        <div className="ue-card-label mono">
          {event.label}
          {event.derived && <span className="ue-derived-tag"> · reconstructed</span>}
        </div>
        <div className="ue-card-sub mono">{event.division || "Division unavailable"} &middot; Year {event.year}</div>
      </div>

      {featured.map((bout, i) => (
        <BoutRow
          key={bout.boutId}
          bout={bout}
          onOpenFighter={onOpenFighter}
          prominence={i === 0 ? "main" : i === 1 ? "comain" : "featured"}
        />
      ))}

      {rest.length > 0 && !expanded && (
        <button type="button" className="text-btn ue-expand-btn" onClick={onExpand}>
          <Swords size={12} /> View Full Card ({bouts.length} bouts)
        </button>
      )}
      {rest.length > 0 && expanded && (
        <>
          <div className="ue-undercard-label mono">FULL CARD</div>
          {rest.map((bout) => (
            <BoutRow key={bout.boutId} bout={bout} onOpenFighter={onOpenFighter} prominence="undercard" />
          ))}
        </>
      )}
    </div>
  );
}

export default UniverseEventCard;
