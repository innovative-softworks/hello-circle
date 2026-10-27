import { useEffect, useState } from "react";
import { fetchProgramEnrollments, fetchSessionAttendance, markSessionAttendance } from "../api";
import type { ProgramEnrollment } from "../api";
import { CheckIcon, SearchIcon } from "./icons";
import { Avatar, Button, EmptyState, LoadErrorState, Modal, PageSpinner } from "./ui";
import { useToast } from "./Toast";
import { ScanPassModal, readPassCode, type ScanResult } from "./pass/ScanPassModal";
import { QrCode } from "lucide-react";
import { errorMessage } from "./admin/adminUi";
import { dateLabel } from "../euro";
import { colors, fonts, radius } from "../theme";
import type { AttendanceStatus } from "../types";

// Host Manage spec §14's mobile-friendly check-in kiosk — mirrors
// HostCheckInScreen.tsx (built for Games) on the Vendor side, reusing the
// existing program enrollment/attendance routes (vendorPrograms.ts's
// fetchSessionAttendance/markSessionAttendance) rather than inventing a
// new data model. "Check in" marks attendance 'present' for one session;
// "Absent" records a no-show (booking no longer implies attendance, so a
// missed session shouldn't read as attended). The count, progress bar and
// search sit in the popup's pinned toolbar so they stay visible while a
// long list scrolls.
export function VendorCheckInScreen({
  programId,
  session,
  onClose,
}: {
  programId: string;
  session: { id: string; date: string; time: string } | null;
  onClose: () => void;
}) {
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[] | null>(null);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const [loadFailed, setLoadFailed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const toast = useToast();

  // Enrolments and the attendance already recorded load together: showing the
  // list without the attendance would make everyone look unmarked at the door.
  const load = () => {
    setEnrollments(null);
    setAttendance({});
    setLoadFailed(false);
    if (!session) return;
    Promise.all([fetchProgramEnrollments(programId), fetchSessionAttendance(programId, session.id)])
      .then(([list, rows]) => {
        const byId: Record<string, AttendanceStatus> = {};
        for (const r of rows) byId[r.enrollmentId] = r.status;
        setAttendance(byId);
        setEnrollments(list);
      })
      .catch(() => setLoadFailed(true));
  };
  useEffect(() => {
    setSearch("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, programId]);

  const active = (enrollments ?? []).filter((e) => e.status !== "cancelled");
  const isPresent = (id: number) => attendance[String(id)] === "present" || attendance[String(id)] === "late";
  const isAbsent = (id: number) => attendance[String(id)] === "absent" || attendance[String(id)] === "no_show";
  const checkedInCount = active.filter((e) => isPresent(e.id)).length;
  const filtered = active.filter((e) => e.participantName.toLowerCase().includes(search.toLowerCase()));

  const mark = async (enrollmentId: number, status: AttendanceStatus) => {
    if (!session) return;
    setBusyId(enrollmentId);
    try {
      await markSessionAttendance(session.id, enrollmentId, status);
      setAttendance((prev) => ({ ...prev, [String(enrollmentId)]: status }));
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save that. Try again."));
    } finally {
      setBusyId(null);
    }
  };

  // Scan passes (owner 2026-10-27): a programme pass holds its enrolment reference.
  const onScan = async (text: string): Promise<ScanResult> => {
    if (!session || !enrollments) return { ok: false, message: "The list is still loading." };
    const code = readPassCode(text);
    if (!code) return { ok: false, message: "That isn't a HelloCircle pass." };
    if (code.kind !== "program") return { ok: false, message: "That pass isn't for a programme." };
    const e = active.find((x) => x.ref.toUpperCase() === code.ref);
    if (!e) return { ok: false, message: "That enrolment isn't on this programme's list." };
    if (isPresent(e.id)) return { ok: true, message: `${e.participantName} is already checked in.` };
    await markSessionAttendance(session.id, e.id, "present");
    setAttendance((prev) => ({ ...prev, [String(e.id)]: "present" }));
    return { ok: true, message: `Checked in: ${e.participantName}` };
  };

  if (scanning && session) {
    return <ScanPassModal open title="Scan passes · session check-in" onClose={() => setScanning(false)} onCode={onScan} />;
  }

  const linkButton = { background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.muted, cursor: "pointer", textDecoration: "underline" } as const;

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="Session check-in"
      subtitle={session ? `${dateLabel(session.date)} · ${session.time}` : undefined}
      toolbar={
        enrollments ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24 }}>
                {checkedInCount} <span style={{ color: colors.mutedLight, fontWeight: 700, fontSize: 18 }}>/ {active.length}</span>
              </div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase" }}>Checked in</div>
            </div>
            <div aria-hidden="true" style={{ height: 6, borderRadius: radius.control, background: colors.panel, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${active.length ? (checkedInCount / active.length) * 100 : 0}%`, background: colors.green, transition: "width .3s ease" }} />
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
        <LoadErrorState title="Couldn't load this session's list" onRetry={load} />
      ) : !enrollments ? (
        <PageSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<SearchIcon size={22} />} title={active.length === 0 ? "No one's enrolled yet" : "No one matches that search"} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((e) => {
            const present = isPresent(e.id);
            const absent = isAbsent(e.id);
            const busy = busyId === e.id;
            return (
              <div
                key={e.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.bg, borderRadius: radius.card, padding: "14px 16px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <Avatar name={e.participantName} size={38} />
                  <div style={{ fontWeight: 700, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.participantName}</div>
                </div>
                {present ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "8px 16px", flex: "none" }}>
                    <CheckIcon size={14} /> Checked in
                  </span>
                ) : absent ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: radius.pill, padding: "8px 14px" }}>Absent</span>
                    <button onClick={() => mark(e.id, "present")} disabled={busy} style={linkButton}>
                      {busy ? "…" : "Undo"}
                    </button>
                  </span>
                ) : (
                  <span style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
                    <button onClick={() => mark(e.id, "absent")} disabled={busy} style={linkButton}>
                      Absent
                    </button>
                    <button
                      onClick={() => mark(e.id, "present")}
                      disabled={busy}
                      style={{ fontSize: 14, fontWeight: 700, color: "#fff", background: colors.dark, border: "none", borderRadius: radius.pill, padding: "10px 20px", cursor: "pointer" }}
                    >
                      {busy ? "…" : "Check in"}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
