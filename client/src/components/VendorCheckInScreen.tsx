import { useEffect, useState } from "react";
import { fetchProgramEnrollments, fetchSessionAttendance, markSessionAttendance } from "../api";
import type { ProgramEnrollment } from "../api";
import { CheckIcon, SearchIcon } from "./icons";
import { Avatar, Drawer, EmptyState, PageSpinner } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { AttendanceStatus } from "../types";

// Host Manage spec §14's mobile-friendly check-in kiosk — mirrors
// HostCheckInScreen.tsx (built for Games) on the Vendor side, reusing the
// existing program enrollment/attendance routes (vendorPrograms.ts's
// fetchSessionAttendance/markSessionAttendance) rather than inventing a
// new data model. "Check in" marks attendance 'present' for one session —
// distinct from a program-wide enrollment, since attendance is already
// tracked per session/enrollment pair.
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

  useEffect(() => {
    setEnrollments(null);
    setAttendance({});
    setSearch("");
    if (session) {
      fetchProgramEnrollments(programId).then(setEnrollments);
      fetchSessionAttendance(programId, session.id).then((rows) => {
        const byId: Record<string, AttendanceStatus> = {};
        for (const r of rows) byId[r.enrollmentId] = r.status;
        setAttendance(byId);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, programId]);

  const active = (enrollments ?? []).filter((e) => e.status !== "cancelled");
  const checkedInCount = active.filter((e) => attendance[String(e.id)] === "present").length;
  const filtered = active.filter((e) => e.participantName.toLowerCase().includes(search.toLowerCase()));

  const checkIn = async (enrollmentId: number) => {
    if (!session) return;
    setBusyId(enrollmentId);
    try {
      await markSessionAttendance(session.id, enrollmentId, "present");
      setAttendance((prev) => ({ ...prev, [String(enrollmentId)]: "present" }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Drawer open={!!session} onClose={onClose} title={session ? `Check-in — ${session.date} ${session.time}` : "Check-in"}>
      {!enrollments ? (
        <PageSpinner />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ textAlign: "center", padding: "6px 0 10px" }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 28 }}>
              {checkedInCount} / {active.length}
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
              {filtered.map((e) => {
                const checkedIn = attendance[String(e.id)] === "present";
                return (
                  <div
                    key={e.id}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.bg, borderRadius: radius.card, padding: "14px 16px" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <Avatar name={e.participantName} size={38} />
                      <div style={{ fontWeight: 700, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.participantName}</div>
                    </div>
                    {checkedIn ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "8px 16px", flex: "none" }}>
                        <CheckIcon size={14} /> Checked in
                      </span>
                    ) : (
                      <button
                        onClick={() => checkIn(e.id)}
                        disabled={busyId === e.id}
                        style={{ fontSize: 14, fontWeight: 700, color: "#fff", background: colors.dark, border: "none", borderRadius: radius.pill, padding: "10px 20px", cursor: "pointer", flex: "none" }}
                      >
                        {busyId === e.id ? "…" : "Check in"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
