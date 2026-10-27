import { useEffect, useMemo, useState } from "react";
import { dateLabel } from "../euro";
import { checkInGameParticipant, fetchGameParticipantsForManage } from "../api";
import { CheckIcon, SearchIcon } from "./icons";
import { Avatar, Button, EmptyState, LoadErrorState, Modal, PageSpinner } from "./ui";
import { useToast } from "./Toast";
import { ScanPassModal, readPassCode, type ScanResult } from "./pass/ScanPassModal";
import { QrCode } from "lucide-react";
import { errorMessage } from "./admin/adminUi";
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const toast = useToast();

  const load = () => {
    setParticipants(null);
    setLoadFailed(false);
    if (game) fetchGameParticipantsForManage(game.id).then(setParticipants).catch(() => setLoadFailed(true));
  };
  useEffect(() => {
    setSearch("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't check them in. Try again."));
    } finally {
      setBusyId(null);
    }
  };

  // Scan passes (owner 2026-10-27): the code on an activity pass names the
  // activity and the person; the check-in is the same host call as the button.
  const onScan = async (text: string): Promise<ScanResult> => {
    if (!game || !participants) return { ok: false, message: "The list is still loading." };
    const code = readPassCode(text);
    if (!code) return { ok: false, message: "That isn't a HelloCircle pass." };
    if (code.kind !== "game") return { ok: false, message: "That pass is for a booking, not this activity." };
    if (code.gameId !== game.id) return { ok: false, message: "That pass is for a different activity or date." };
    const p = joined.find((x) => x.residentId === code.residentId);
    if (!p) return { ok: false, message: "They're not on the list for this activity." };
    if (p.paymentStatus && p.paymentStatus !== "paid") return { ok: false, message: `${p.name}'s payment isn't confirmed yet.` };
    if (p.checkedInAt) return { ok: true, message: `${p.name} is already checked in.` };
    await checkInGameParticipant(game.id, p.residentId);
    setParticipants((prev) => prev && prev.map((x) => (x.residentId === p.residentId ? { ...x, checkedInAt: new Date().toISOString() } : x)));
    return { ok: true, message: `Checked in: ${p.name}` };
  };

  if (scanning && game) {
    return <ScanPassModal open title={`Scan passes · ${game.activityLabel}`} onClose={() => setScanning(false)} onCode={onScan} />;
  }

  return (
    <Modal
      open={!!game}
      onClose={onClose}
      title={game ? `${game.activityLabel} — check-in` : "Check-in"}
      subtitle={game ? `${dateLabel(game.date)} · ${game.time}` : undefined}
      toolbar={
        participants ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24 }}>
                {checkedInCount} <span style={{ color: colors.mutedLight, fontWeight: 700, fontSize: 18 }}>/ {joined.length}</span>
              </div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase" }}>Checked in</div>
            </div>
            <div aria-hidden="true" style={{ height: 6, borderRadius: radius.control, background: colors.panel, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${joined.length ? (checkedInCount / joined.length) * 100 : 0}%`, background: colors.green, transition: "width .3s ease" }} />
            </div>
            <Button variant="ghost" onClick={() => setScanning(true)}>
              <QrCode size={16} aria-hidden="true" /> Scan passes
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "10px 14px" }}>
              <SearchIcon size={15} style={{ color: colors.faint }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search participant"
                aria-label="Search participants"
                style={{ flex: 1, border: "none", background: "none", fontSize: 15, outline: "none" }}
              />
            </div>
          </div>
        ) : undefined
      }
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      {loadFailed ? (
        <LoadErrorState title="Couldn't load the participant list" onRetry={load} />
      ) : !participants ? (
        <PageSpinner />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {filtered.length === 0 ? (
            <EmptyState icon={<SearchIcon size={22} />} title={joined.length === 0 ? "No one's joined yet" : "No one matches that search"} />
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
    </Modal>
  );
}
