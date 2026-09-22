import { useEffect, useMemo, useState } from "react";
import { checkInGameParticipant, fetchGameParticipantsForManage } from "../api";
import { CheckIcon, SearchIcon } from "./icons";
import { Avatar, Drawer, EmptyState, PageSpinner } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Game, ManageParticipant } from "../types";

// Host Manage spec §11's mobile-friendly check-in kiosk — large tap
// targets, a search box, "Checked in: X/Y" header. Reuses the existing
// host-only participants fetch (fetchGameParticipantsForManage,
// ManageParticipant already has checkedInAt) plus the new host-run
// check-in route (checkInGameParticipant) — distinct from a resident's own
// self-serve check-in, which this doesn't touch.
export function HostCheckInScreen({ game, onClose }: { game: Game | null; onClose: () => void }) {
  const [participants, setParticipants] = useState<ManageParticipant[] | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setParticipants(null);
    setSearch("");
    if (game) fetchGameParticipantsForManage(game.id).then(setParticipants);
  }, [game?.id]);

  const joined = useMemo(() => (participants ?? []).filter((p) => p.status === "joined" || p.status === "pending_payment"), [participants]);
  const checkedInCount = joined.filter((p) => p.checkedInAt).length;
  const filtered = joined.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  const handleCheckIn = async (residentId: string) => {
    if (!game) return;
    setBusyId(residentId);
    try {
      await checkInGameParticipant(game.id, residentId);
      setParticipants((prev) => prev && prev.map((p) => (p.residentId === residentId ? { ...p, checkedInAt: new Date().toISOString() } : p)));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Drawer open={!!game} onClose={onClose} title={game ? `${game.activityLabel} — check-in` : "Check-in"}>
      {!participants ? (
        <PageSpinner />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ textAlign: "center", padding: "6px 0 10px" }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 28 }}>
              {checkedInCount} / {joined.length}
            </div>
            <div style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase" }}>Checked in</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
            <SearchIcon size={15} style={{ color: colors.faint }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search participant"
              style={{ flex: 1, border: "none", background: "none", fontSize: 15, outline: "none" }}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={<SearchIcon size={22} />} title="No one matches that search" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map((p) => (
                <div
                  key={p.residentId}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.bg, borderRadius: radius.card, padding: "14px 16px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <Avatar name={p.name} size={38} />
                    <div style={{ fontWeight: 700, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  </div>
                  {p.checkedInAt ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "8px 16px", flex: "none" }}>
                      <CheckIcon size={14} /> Checked in
                    </span>
                  ) : (
                    <button
                      onClick={() => handleCheckIn(p.residentId)}
                      disabled={busyId === p.residentId}
                      style={{ fontSize: 14, fontWeight: 700, color: "#fff", background: colors.dark, border: "none", borderRadius: radius.pill, padding: "10px 20px", cursor: "pointer", flex: "none" }}
                    >
                      {busyId === p.residentId ? "…" : "Check in"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
