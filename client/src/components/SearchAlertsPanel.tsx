import { useEffect, useState } from "react";
import { deleteSearchAlert, fetchSearchAlerts, setSearchAlertActive } from "../api";
import { BellIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { SearchAlert } from "../types";

// Saved-search alerts (master-prompt punch list #5) — a resident saves a
// county/keywords/mood combination once (from Search.tsx's "Notify me"
// action) and gets a notification whenever a new Game matching it is
// created (trigger-based match in server/src/searchAlerts.ts, not a
// periodic scan). Shown in MyBookings.tsx's ("My Life") Profile tab.

function describe(a: SearchAlert): string {
  const parts = [a.county, a.keywords, a.mood ? `mood: ${a.mood}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Any new game";
}

export function SearchAlertsPanel() {
  const [alerts, setAlerts] = useState<SearchAlert[]>([]);
  const load = () => fetchSearchAlerts().then(setAlerts);
  useEffect(() => { load(); }, []);

  if (alerts.length === 0) return null;

  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <BellIcon size={16} style={{ color: colors.greenText }} />
        <span style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: 700 }}>Saved search alerts</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {alerts.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: `1px solid ${colors.border}` }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{describe(a)}</div>
              <div style={{ fontSize: 11.5, color: colors.faint }}>{a.active ? "Active" : "Paused"}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flex: "none" }}>
              <button
                onClick={() => setSearchAlertActive(a.id, !a.active).then(load)}
                style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
              >
                {a.active ? "Pause" : "Resume"}
              </button>
              <button
                onClick={() => deleteSearchAlert(a.id).then(load)}
                style={{ background: "none", border: "none", color: colors.danger, fontSize: 12, cursor: "pointer" }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
