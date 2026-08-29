import { useEffect, useRef, useState } from "react";
import { searchResidents } from "../api";
import { Button } from "./ui";
import { colors, radius } from "../theme";
import type { ResidentSearchResult } from "../types";

const DEBOUNCE_MS = 250;

// Circle invite picker (implementation backlog #3) — replaces the raw
// Resident-ID text field with a real name search, scoped to residents who
// opted in via the Privacy card's "findable by name" toggle (see
// residents.ts's GET /search — off by default, so results will be sparse
// until adoption grows). Kept alongside a manual "enter a Resident ID
// directly" fallback for the (likely common, early on) case where the
// person you want to invite hasn't opted in yet.

export function ResidentPicker({ onInvite }: { onInvite: (residentId: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResidentSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualId, setManualId] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchResidents(query.trim())
        .then((rows) => {
          setResults(rows);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = async (r: ResidentSearchResult) => {
    setBusy(true);
    setOpen(false);
    setQuery("");
    try {
      await onInvite(r.id);
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    if (!manualId.trim()) return;
    setBusy(true);
    try {
      await onInvite(manualId.trim());
      setManualId("");
    } finally {
      setBusy(false);
    }
  };

  if (manualMode) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder="Resident ID"
          style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5, maxWidth: 220 }}
        />
        <Button variant="ghost" onClick={submitManual} disabled={busy || !manualId.trim()}>Invite</Button>
        <button onClick={() => setManualMode(false)} style={{ background: "none", border: "none", padding: 0, color: colors.faint, fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
          Search by name instead
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search by name to invite…"
          disabled={busy}
          style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5, maxWidth: 220 }}
        />
        <button onClick={() => setManualMode(true)} style={{ background: "none", border: "none", padding: 0, color: colors.faint, fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
          Have a Resident ID instead?
        </button>
      </div>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 200,
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control,
            boxShadow: "0 10px 24px rgba(30,40,32,.14)", overflow: "hidden",
          }}
        >
          {results.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12.5, color: colors.faint }}>
              No one findable by that name — they may not have turned on "findable by name" yet.
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => pick(r)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "9px 12px", fontSize: 13.5, cursor: "pointer" }}
              >
                {r.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
