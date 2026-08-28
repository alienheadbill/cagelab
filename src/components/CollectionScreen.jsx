import React, { useState, useRef } from "react";
import { ArrowLeft, Star, Eye, Download, Upload } from "lucide-react";
import { computePlayerProfile } from "../lib/career.js";
import { buildScorecardText } from "../lib/scoring.js";
import { exportAllData, importAllData } from "../lib/storage.js";
import { sfx } from "../lib/audio.js";

// ---------- Trophy Case / Collection screen ----------
function CollectionScreen({
  onBack, dailyStats, savedBuilds, careerHistory, dailyLog, achievements,
  reducedMotion, onToggleReducedMotion, onLoadBuild, onClearBuilds, onClearCareers, onImportFile,
}) {
  const fileInputRef = useRef(null);
  const [importMsg, setImportMsg] = useState("");
  const [copiedBuildId, setCopiedBuildId] = useState(null);
  // Default straight to the Builds tab when there's anything saved -- that's
  // the thing people come back for most, so it shouldn't need a tap+scroll.
  const [activeTab, setActiveTab] = useState(savedBuilds.length > 0 ? "builds" : "profile");
  const profile = computePlayerProfile({ dailyStats, savedBuilds, careerHistory });

  // Quick clipboard copy straight from Trophy Case, without leaving the screen --
  // reconstructs just enough of the picks shape for buildScorecardText to read.
  function copyBuildScorecard(build) {
    const picksForText = {};
    (build.picks || []).forEach((p) => { picksForText[p.key] = { fighter: p.fighter, display: p.display }; });
    const text = buildScorecardText({ name: build.fighterName, goatScore: build.goatScore, picks: picksForText });
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    sfx("select");
    setCopiedBuildId(build.id);
    setTimeout(() => setCopiedBuildId((id) => (id === build.id ? null : id)), 1600);
  }

  const TABS = [
    { id: "profile", label: "Profile" },
    { id: "builds", label: `Builds (${savedBuilds.length})` },
    { id: "careers", label: `Careers (${careerHistory.length})` },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="panel">
      <div className="section-head-row">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={16} /></button>
        <div className="attr-name">Trophy Case</div>
      </div>

      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t.id} className={`tab-btn ${activeTab === t.id ? "active" : ""}`} onClick={() => { sfx("select"); setActiveTab(t.id); }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <>
          <div className="collection-block">
            <div className="collection-block-title">Fighter Profile</div>
            <div className="profile-grid">
              <div className="stat-box"><div className="stat-num">{profile.totalBuilds}</div><div className="stat-lbl">Total Builds</div></div>
              <div className="stat-box"><div className="stat-num">{profile.bestGoat}</div><div className="stat-lbl">Best GOAT</div></div>
              <div className="stat-box"><div className="stat-num">{profile.dailyStreak}</div><div className="stat-lbl">Daily Streak</div></div>
              <div className="stat-box"><div className="stat-num">{profile.careersCompleted}</div><div className="stat-lbl">Careers Done</div></div>
              <div className="stat-box"><div className="stat-num">{profile.championships}</div><div className="stat-lbl">Championships</div></div>
              <div className="stat-box"><div className="stat-num">{profile.hofCareers}</div><div className="stat-lbl">HOF Careers</div></div>
            </div>
            {profile.bestRecord && (
              <div className="profile-line mono">Best Career Record: <b>{profile.bestRecord.w}-{profile.bestRecord.l}</b></div>
            )}
            {profile.favoriteFighter && (
              <div className="profile-line mono">Most-Used Fighter: <b>{profile.favoriteFighter.name}</b> ({profile.favoriteFighter.count}&times;)</div>
            )}
          </div>

          <div className="collection-block">
            <div className="collection-block-title">Daily Challenge</div>
            <div className="daily-stats-row">
              <div className="stat-box"><div className="stat-num">{dailyStats.bestScore}</div><div className="stat-lbl">Best Score</div></div>
              <div className="stat-box"><div className="stat-num">{dailyStats.currentStreak}</div><div className="stat-lbl">Day Streak</div></div>
            </div>
            {dailyLog.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="help-text" style={{ marginBottom: 6 }}>Your recent Daily scores (local to this device):</div>
                {dailyLog.slice(0, 8).map((d) => (
                  <div className="collection-row" key={d.date}>
                    <div className="collection-row-sub mono">{d.date}</div>
                    <div className="mono" style={{ fontWeight: 600 }}>{d.score}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="collection-block">
            <div className="collection-block-title">Achievements</div>
            {achievements.map((a) => (
              <div className="collection-row" key={a.id}>
                <div>
                  <div className="collection-row-title" style={{ opacity: a.achieved ? 1 : 0.4 }}>{a.achieved ? "✓ " : "🔒 "}{a.label}</div>
                  <div className="collection-row-sub">{a.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === "builds" && (
        <div className="collection-block">
          <div className="collection-block-title-row">
            <div className="collection-block-title">Saved Builds ({savedBuilds.length})</div>
            {savedBuilds.length > 0 && <button className="text-btn" onClick={onClearBuilds}>Clear</button>}
          </div>
          {savedBuilds.length === 0 && <div className="empty-txt">No builds saved yet — finish a draft and hit "Save Build" to see it here.</div>}
          {savedBuilds.map((b) => (
            <div className="saved-build-card" key={b.id}>
              <div className="collection-row" style={{ borderTop: "none", padding: "0 0 8px" }}>
                <div>
                  <div className="collection-row-title">{b.fighterName}</div>
                  <div className="collection-row-sub mono">{b.mode} &middot; {new Date(b.savedAt).toLocaleDateString()}</div>
                </div>
                <div className="tier-badge tier-gold"><Star size={11} /> {b.goatScore}</div>
              </div>
              <div className="saved-build-actions">
                <button className="text-btn" onClick={() => onLoadBuild(b)}>Load into Career</button>
                <button className="text-btn" onClick={() => copyBuildScorecard(b)}>
                  {copiedBuildId === b.id ? "Copied!" : "Copy Scorecard"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "careers" && (
        <div className="collection-block">
          <div className="collection-block-title-row">
            <div className="collection-block-title">Recent Careers ({careerHistory.length})</div>
            {careerHistory.length > 0 && <button className="text-btn" onClick={onClearCareers}>Clear</button>}
          </div>
          {careerHistory.length === 0 && <div className="empty-txt">No careers played yet.</div>}
          {careerHistory.map((c) => (
            <div className="collection-row" key={c.id}>
              <div>
                <div className="collection-row-title">{c.fighterName}</div>
                <div className="collection-row-sub mono">{c.record.w}-{c.record.l} &middot; {c.verdict}</div>
              </div>
              <div className="mono" style={{ fontWeight: 600 }}>{c.legacyScore}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "settings" && (
        <>
          <div className="collection-block">
            <div className="collection-block-title">Accessibility</div>
            <button className={`choice-btn full ${reducedMotion ? "active" : ""}`} onClick={onToggleReducedMotion}>
              <Eye size={14} /> Reduce Motion {reducedMotion ? "(On)" : "(Off)"}
            </button>
          </div>

          <div className="collection-block">
            <div className="collection-block-title">Your Data</div>
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={exportAllData}><Download size={16} /> Export</button>
              <button className="btn btn-ghost" onClick={() => fileInputRef.current && fileInputRef.current.click()}><Upload size={16} /> Import</button>
            </div>
            <input
              ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                importAllData(file, (ok) => {
                  setImportMsg(ok ? "Imported! Reopen Trophy Case to refresh." : "Import failed — invalid file.");
                  if (ok) onImportFile();
                });
              }}
            />
            {importMsg && <div className="help-text" style={{ marginTop: 8 }}>{importMsg}</div>}
          </div>
        </>
      )}
    </div>
  );
}

export default CollectionScreen;
