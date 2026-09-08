import React, { useState, useMemo } from "react";
import { ArrowLeft, Crown } from "lucide-react";
import { getEventDisplayModel, listEventsNewestFirst } from "../lib/universeHistory.js";
import UniverseEventCard from "./UniverseEventCard.jsx";
import FighterHistoryPanel from "./FighterHistoryPanel.jsx";

const CIRCUIT_FILTERS = [
  { id: "ALL", label: "ALL" },
  { id: "CLF Regional", label: "REGIONAL" },
  { id: "CLF National", label: "NATIONAL" },
  { id: "CLF PREMIER", label: "PREMIER" },
  { id: "CLF Contender Series", label: "CS" },
];

// One row in the browse list -- Section 11: circuit+number, division,
// year, main-event headline, title/player indicators. Full 15-bout card
// is detail-only, never rendered here.
function EventListRow({ event, onOpen }) {
  const t = event.circuitShort;
  const mainBout = event.bouts[0];
  const hasPlayer = event.bouts.some((b) => b.a.isPlayer || b.b.isPlayer);
  const hasTitle = event.bouts.some((b) => b.titleFight);
  return (
    <button type="button" className="ue-list-row" onClick={onOpen}>
      <div className="ue-list-row-main">
        <div className="ue-list-row-label mono">
          {t} {event.eventNumber != null ? event.eventNumber : ""}
          {event.derived && <span className="ue-derived-tag"> · reconstructed</span>}
        </div>
        <div className="ue-list-row-sub">
          {mainBout ? `${mainBout.a.name} vs ${mainBout.b.name}` : "No bouts recorded"}
        </div>
      </div>
      <div className="ue-list-row-tags">
        {hasTitle && <span className="ue-tag ue-tag-title"><Crown size={10} /> TITLE</span>}
        {hasPlayer && <span className="ue-tag ue-tag-player">YOU</span>}
        <span className="ue-list-row-meta mono">{event.division || "—"} &middot; Y{event.year}</span>
      </div>
    </button>
  );
}

// Manages its own tiny navigation stack (list -> event -> fighter ->
// fighter -> ...) -- a simple push/pop, not a browser route rewrite, so
// "back" always returns to exactly where the player was (Section 22/30).
function EventArchivePanel({ history, onBack, title }) {
  const [circuitFilter, setCircuitFilter] = useState("ALL");
  const [stack, setStack] = useState([{ view: "list" }]);
  const [expandedEventIds, setExpandedEventIds] = useState(() => new Set());
  const top = stack[stack.length - 1];

  const events = useMemo(() => listEventsNewestFirst(history, circuitFilter), [history, circuitFilter]);

  function openEvent(eventId) { setStack((s) => [...s, { view: "event", eventId }]); }
  function openFighter(fighterId) { setStack((s) => [...s, { view: "fighter", fighterId }]); }
  function goBack() {
    if (stack.length > 1) setStack((s) => s.slice(0, -1));
    else onBack();
  }
  function toggleExpand(eventId) {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  }

  if (top.view === "fighter") {
    return (
      <FighterHistoryPanel
        history={history}
        fighterId={top.fighterId}
        onOpenFighter={openFighter}
        onBack={goBack}
      />
    );
  }

  if (top.view === "event") {
    const rawEvent = history.events.find((ev) => `${ev.circuit}-${ev.worldTick}-${ev.eventNumber}` === top.eventId);
    if (!rawEvent) return null;
    const display = getEventDisplayModel(rawEvent, history);
    return (
      <div>
        <div className="section-head-row">
          <button className="icon-btn" onClick={goBack} aria-label="Back"><ArrowLeft size={16} /></button>
          <div className="attr-name">{display.label}</div>
        </div>
        <UniverseEventCard
          event={display}
          onOpenFighter={openFighter}
          expanded={expandedEventIds.has(top.eventId)}
          onExpand={() => toggleExpand(top.eventId)}
        />
      </div>
    );
  }

  // ---- list view ----
  return (
    <div>
      <div className="section-head-row">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="attr-name">{title || "Event Archive"}</div>
      </div>

      <div className="tab-bar">
        {CIRCUIT_FILTERS.map((f) => (
          <button
            key={f.id}
            className={`tab-btn ${circuitFilter === f.id ? "active" : ""}`}
            onClick={() => setCircuitFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="empty-txt">No events recorded yet for this filter.</div>
      ) : (
        events.map((ev) => {
          const display = getEventDisplayModel(ev, history);
          const id = `${ev.circuit}-${ev.worldTick}-${ev.eventNumber}`;
          return <EventListRow key={id} event={display} onOpen={() => openEvent(id)} />;
        })
      )}
    </div>
  );
}

export default EventArchivePanel;
