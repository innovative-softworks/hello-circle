import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addHouseholdMember,
  changeResidentPassword,
  createRoutine,
  deleteHouseholdMember,
  fetchBlockedResidents,
  fetchFavourites,
  fetchHousehold,
  fetchMyFollows,
  fetchMyPasses,
  fetchMyReports,
  fetchMyRoutines,
  fetchReceipts,
  fetchResidentFull,
  fetchResidentNotifications,
  fetchRoutineSuggestions,
  markResidentNotificationRead,
  removeFavourite,
  saveAccessibilityPrefs,
  saveNotificationPrefs,
  saveOnboarding,
  setFollowNotificationLevel,
  unblockResident,
  unfollowEntity,
  updateFavouriteStatus,
  updateHouseholdMember,
  updatePrivacyPrefs,
  updateResidentMe,
  updateRoutine,
} from "../api";
import type { FollowedEntity, NotificationLevel } from "../api";
import { BuildingIcon, ChevronRightIcon, PersonIcon } from "../components/icons";
import { HostApplicationPanel } from "../components/HostApplicationPanel";
import { HostDashboardPanel } from "../components/HostDashboardPanel";
import { BecomeProviderPanel } from "../components/BecomeProviderPanel";
import { PaymentMethodsPanel } from "../components/PaymentMethodsPanel";
import { Photo } from "../components/Photo";
import { SearchAlertsPanel } from "../components/SearchAlertsPanel";
import { Button, EmptyState, RowSkeleton, Tabs, inputStyle, labelStyle } from "../components/ui";
import { PageTitle } from "../components/PageTitle";
import { signInHref } from "../authRedirect";
import { euro } from "../euro";
import { useGuest } from "../GuestContext";
import { colors, fonts, radius } from "../theme";
import { ACCESSIBILITY_OPTIONS, BUDGET_OPTIONS, GOAL_OPTIONS, GROUP_SIZE_OPTIONS } from "../types";
import type { BlockedResident, Favourite, HostStatus, HouseholdMember, NotificationPrefs, Pass, Receipt, ReportRecord, ResidentNotification, Routine, RoutineSuggestion } from "../types";

// Profile & settings (My Life redesign §46) — split out of what used to be
// MyBookings.tsx's "More" tab menu. My Life itself (still served at
// /bookings — real magic-link emails point there, not renamed) is now a
// participation-first hub; account administration lives here instead,
// reached via its own "Edit profile" action rather than sitting alongside
// Next Up / My Circles / Do It Again as an equal-weight tab.

// --- Household (MVP, relocated unchanged) -----------------------------------

function HouseholdPanel() {
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [consent, setConsent] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = () => {
    setLoading(true);
    fetchHousehold()
      .then(setMembers)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleAdd = async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    setAdding(true);
    try {
      await addHouseholdMember({ firstName: firstName.trim(), lastName: lastName.trim(), dob: dob || undefined, guardianConsentGiven: consent });
      setFirstName("");
      setLastName("");
      setDob("");
      setConsent(false);
      load();
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: number) => {
    await deleteHouseholdMember(id);
    setMembers((rows) => rows.filter((m) => m.id !== id));
  };

  const toggleConsent = async (m: HouseholdMember) => {
    await updateHouseholdMember(m.id, { guardianConsentGiven: !m.guardianConsentGiven });
    setMembers((rows) => rows.map((r) => (r.id === m.id ? { ...r, guardianConsentGiven: !r.guardianConsentGiven } : r)));
  };

  return (
    <div>
      <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 20px" }}>
        Add kids or dependants once — pick them straight from here next time you register for a club instead of retyping their details.
      </p>
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Add a household member</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 160px" }}>
            <label style={labelStyle}>First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label style={labelStyle}>Last name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label style={labelStyle}>Date of birth</label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={inputStyle} />
          </div>
          <Button onClick={handleAdd} disabled={adding || !firstName.trim() || !lastName.trim()}>
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: colors.mutedLight, marginTop: 12 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ accentColor: colors.green }} />
          I am this person's parent or guardian and consent to registering activities on their behalf
        </label>
      </div>

      {loading ? (
        <RowSkeleton />
      ) : members.length === 0 ? (
        <EmptyState icon={<ChevronRightIcon size={20} />} title="No household members yet" subtitle="Add one above to speed up club registrations." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map((m) => (
            <div key={m.id} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{m.firstName} {m.lastName}</div>
                {m.dob && <div style={{ fontSize: 13, color: colors.mutedLight }}>Born {m.dob}</div>}
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.mutedLight, marginTop: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={m.guardianConsentGiven} onChange={() => toggleConsent(m)} style={{ accentColor: colors.green }} />
                  Guardian consent on file
                </label>
              </div>
              <Button variant="danger" onClick={() => handleRemove(m.id)}>Remove</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Favourites / Saved (MVP, relocated unchanged) --------------------------

const FAVOURITE_LISTING_LABEL: Record<Favourite["listingType"], string> = {
  centre: "Community centre",
  club: "Sports club",
  game: "Game",
  program_session: "Program session",
  club_session: "Club session",
  experience: "Adventure / Experience",
};

const STATUS_LABEL: Record<Favourite["status"], string> = { interested: "Interested", planning: "Planning", joined: "Joined" };
const NEXT_STATUS: Record<Favourite["status"], Favourite["status"] | null> = { interested: "planning", planning: "joined", joined: null };
const STATUS_COLOR: Record<Favourite["status"], { fg: string; bg: string }> = {
  interested: { fg: colors.muted, bg: colors.panel },
  planning: { fg: colors.orangeDark, bg: "#FFF3D6" },
  joined: { fg: colors.greenText, bg: colors.greenBg },
};

const STATUS_FILTERS: { key: Favourite["status"] | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "interested", label: "Interested" },
  { key: "planning", label: "Planning" },
  { key: "joined", label: "Joined" },
];

function FavouritesPanel() {
  const navigate = useNavigate();
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Favourite["status"] | "all">("all");

  useEffect(() => {
    fetchFavourites()
      .then(setFavourites)
      .finally(() => setLoading(false));
  }, []);

  const handleRemove = async (f: Favourite) => {
    await removeFavourite(f.listingType, f.listingId);
    setFavourites((rows) => rows.filter((r) => !(r.listingType === f.listingType && r.listingId === f.listingId)));
  };

  const handleAdvanceStatus = async (f: Favourite) => {
    const next = NEXT_STATUS[f.status];
    if (!next) return;
    await updateFavouriteStatus(f.listingType, f.listingId, next);
    setFavourites((rows) => rows.map((r) => (r.listingType === f.listingType && r.listingId === f.listingId ? { ...r, status: next } : r)));
  };

  if (loading) return <RowSkeleton />;
  if (favourites.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="No favourites yet" subtitle="Tap the heart on a centre or club to save it here." />;
  }

  const filtered = statusFilter === "all" ? favourites : favourites.filter((f) => f.status === statusFilter);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStatusFilter(s.key)}
            style={{
              border: "none", borderRadius: radius.pill, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: statusFilter === s.key ? colors.dark : colors.panel, color: statusFilter === s.key ? "#fff" : colors.muted,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<ChevronRightIcon size={20} />} title="Nothing here" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((f) => {
            const next = NEXT_STATUS[f.status];
            const detailHref =
              f.listingType === "centre"
                ? `/centres/${f.listingId}`
                : f.listingType === "club"
                  ? `/clubs/${f.listingId}`
                  : f.listingType === "game"
                    ? `/games/${f.listingId}`
                    : f.listingType === "experience"
                      ? `/experiences/${f.listingId}`
                      : null;
            return (
              <div key={`${f.listingType}:${f.listingId}`} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <button
                  onClick={() => detailHref && navigate(detailHref)}
                  disabled={!detailHref}
                  style={{ background: "none", border: "none", padding: 0, cursor: detailHref ? "pointer" : "default", fontWeight: 700, color: colors.text, textAlign: "left" }}
                >
                  {FAVOURITE_LISTING_LABEL[f.listingType]} — view listing
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={() => handleAdvanceStatus(f)}
                    disabled={!next}
                    title={next ? `Mark as ${STATUS_LABEL[next]}` : "Already joined"}
                    style={{
                      fontSize: 12, fontWeight: 700, borderRadius: radius.pill, padding: "4px 12px", border: "none",
                      color: STATUS_COLOR[f.status].fg, background: STATUS_COLOR[f.status].bg,
                      cursor: next ? "pointer" : "default",
                    }}
                  >
                    {STATUS_LABEL[f.status]}
                  </button>
                  <Button variant="danger" onClick={() => handleRemove(f)}>Remove</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Following (Follow feature) ----------------------------------------

const LEVEL_LABELS: Record<NotificationLevel, string> = { highlights: "Highlights", everything: "Everything" };

/** A resident's standing follow relationships in one place — there was
 * previously no way to see or manage the full list (FollowButton only
 * ever surfaced one follow/unfollow at a time, on the followed entity's
 * own page). Mirrors FavouritesPanel's shape (remove action, per-row
 * secondary control) rather than inventing a new layout. */
function FollowingPanel() {
  const navigate = useNavigate();
  const [follows, setFollows] = useState<FollowedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [openLevelMenu, setOpenLevelMenu] = useState<string | null>(null);

  useEffect(() => {
    fetchMyFollows()
      .then(setFollows)
      .finally(() => setLoading(false));
  }, []);

  const key = (f: FollowedEntity) => `${f.followedType}:${f.followedId}`;

  const handleUnfollow = async (f: FollowedEntity) => {
    await unfollowEntity(f.followedType, f.followedId);
    setFollows((rows) => rows.filter((r) => key(r) !== key(f)));
  };

  const handleLevelChange = async (f: FollowedEntity, level: NotificationLevel) => {
    setOpenLevelMenu(null);
    await setFollowNotificationLevel(f.followedType, f.followedId, level);
    setFollows((rows) => rows.map((r) => (key(r) === key(f) ? { ...r, notificationLevel: level } : r)));
  };

  if (loading) return <RowSkeleton />;
  if (follows.length === 0) {
    return <EmptyState icon={<PersonIcon size={20} />} title="Not following anyone yet" subtitle="Follow a host or provider from their profile to hear when they start something new." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {follows.map((f) => (
        <div
          key={key(f)}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
        >
          <button
            onClick={() => navigate(f.href)}
            style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <Photo
              src={f.imageUrl ?? undefined}
              alt={f.name ?? ""}
              ph={colors.panel}
              style={{ width: 38, height: 38, borderRadius: "50%", overflow: "hidden", flex: "none" }}
              icon={!f.imageUrl ? f.followedType === "vendor" ? <BuildingIcon size={14} /> : <PersonIcon size={14} /> : undefined}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: colors.text }}>{f.name ?? "Removed account"}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight }}>{f.followedType === "vendor" ? "Provider" : "Host"}</div>
            </div>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
            <button
              onClick={() => setOpenLevelMenu((k) => (k === key(f) ? null : key(f)))}
              style={{ background: colors.panel, border: "none", borderRadius: radius.pill, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: colors.muted, cursor: "pointer" }}
            >
              {LEVEL_LABELS[f.notificationLevel]}
            </button>
            {openLevelMenu === key(f) && (
              <div
                style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 10, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, boxShadow: "0 8px 24px rgba(20,22,20,.12)", minWidth: 140, overflow: "hidden" }}
              >
                {(Object.keys(LEVEL_LABELS) as NotificationLevel[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => handleLevelChange(f, l)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", fontSize: 13, fontWeight: l === f.notificationLevel ? 700 : 500, background: l === f.notificationLevel ? colors.panel : "none", border: "none", cursor: "pointer", color: colors.text }}
                  >
                    {LEVEL_LABELS[l]}
                  </button>
                ))}
              </div>
            )}
            <Button variant="danger" onClick={() => handleUnfollow(f)}>Unfollow</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Resident notifications (MVP, relocated unchanged) ----------------------

function NotificationsPanel() {
  const [notifications, setNotifications] = useState<ResidentNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetchResidentNotifications()
      .then(setNotifications)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRead = async (id: number) => {
    await markResidentNotificationRead(id);
    setNotifications((rows) => rows.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
  };

  if (loading) return <RowSkeleton />;
  if (notifications.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="Nothing yet" subtitle="Waitlist offers and game updates will show up here." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {notifications.map((n) => (
        <div
          key={n.id}
          onClick={() => !n.read && handleRead(n.id)}
          style={{
            background: n.read ? colors.surface : colors.greenBg,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            padding: "14px 18px",
            cursor: n.read ? "default" : "pointer",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{n.title}</div>
          <div style={{ fontSize: 13.5, color: colors.mutedLight, marginTop: 2 }}>{n.body}</div>
        </div>
      ))}
    </div>
  );
}

// --- Routines (IA spec §9, relocated unchanged) ------------------------------

const ROUTINE_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function RoutinesPanel() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [suggestions, setSuggestions] = useState<RoutineSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchMyRoutines(), fetchRoutineSuggestions()])
      .then(([r, s]) => {
        setRoutines(r);
        setSuggestions(s);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const acceptSuggestion = async (s: RoutineSuggestion) => {
    const key = `${s.activityLabel}::${s.dayOfWeek}`;
    setBusyKey(key);
    try {
      await createRoutine({ activityLabel: s.activityLabel, centreId: s.centreId, dayOfWeek: s.dayOfWeek, time: s.time });
      load();
    } finally {
      setBusyKey(null);
    }
  };

  const toggleStatus = async (r: Routine) => {
    setBusyKey(r.id);
    try {
      await updateRoutine(r.id, { status: r.status === "active" ? "paused" : "active" });
      load();
    } finally {
      setBusyKey(null);
    }
  };

  const cancelRoutine = async (r: Routine) => {
    setBusyKey(r.id);
    try {
      await updateRoutine(r.id, { status: "cancelled" });
      setRoutines((rows) => rows.filter((row) => row.id !== r.id));
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return <RowSkeleton />;

  const visibleSuggestions = suggestions.filter((s) => !dismissed.has(`${s.activityLabel}::${s.dayOfWeek}`));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {visibleSuggestions.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px", letterSpacing: ".02em" }}>SUGGESTED</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleSuggestions.map((s) => {
              const key = `${s.activityLabel}::${s.dayOfWeek}`;
              return (
                <div key={key} style={{ background: colors.greenBg, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.activityLabel}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>
                      You've been going most {ROUTINE_DAY_NAMES[s.dayOfWeek - 1]}s ({s.sessionCount} times recently)
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button onClick={() => acceptSuggestion(s)} disabled={busyKey === key}>Make it a routine</Button>
                    <Button variant="ghost" onClick={() => setDismissed((d) => new Set(d).add(key))}>Not now</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px", letterSpacing: ".02em" }}>YOUR ROUTINES</h4>
        {routines.length === 0 ? (
          <EmptyState icon={<ChevronRightIcon size={20} />} title="No routines yet" subtitle="Keep showing up to the same activity and we'll suggest making it a routine." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {routines.map((r) => (
              <div key={r.id} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.activityLabel}</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>
                    Every {ROUTINE_DAY_NAMES[r.dayOfWeek - 1]}{r.time ? ` · ${r.time}` : ""}{r.centreName ? ` · ${r.centreName}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: radius.pill, padding: "3px 10px", background: r.status === "active" ? colors.greenBg : colors.panel, color: r.status === "active" ? colors.greenText : colors.muted }}>
                    {r.status === "active" ? "Active" : "Paused"}
                  </span>
                  <Button variant="ghost" onClick={() => toggleStatus(r)} disabled={busyKey === r.id}>
                    {r.status === "active" ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="danger" onClick={() => cancelRoutine(r)} disabled={busyKey === r.id}>Cancel</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Passes (relocated unchanged) --------------------------------------

function PassesPanel() {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMyPasses()
      .then(setPasses)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <RowSkeleton />;
  if (passes.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="No passes yet" subtitle="A club offering a credit pack will show it on their page." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {passes.map((p) => (
        <div key={p.id} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{p.listingName}</div>
            <div style={{ fontSize: 13, color: colors.mutedLight }}>{p.creditsTotal - p.creditsUsed} of {p.creditsTotal} credits left</div>
          </div>
          <div style={{ fontWeight: 700 }}>{euro(p.purchasedCents / 100)}</div>
        </div>
      ))}
    </div>
  );
}

// --- Receipts / payment history (relocated unchanged) -----------------------

const RECEIPT_LABELS: Record<Receipt["kind"], string> = {
  booking: "Hall booking",
  registration: "Club registration",
  game: "Game",
  pass: "Pass",
  program_enrollment: "Program enrollment",
};

function ReceiptsPanel() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReceipts()
      .then(setReceipts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <RowSkeleton />;
  if (receipts.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="No payments yet" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {receipts.map((r) => (
        <div key={r.ref} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{r.label}</div>
            <div style={{ fontSize: 13, color: colors.mutedLight }}>{RECEIPT_LABELS[r.kind]} · {r.ref} · {r.createdAt.slice(0, 10)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700 }}>{euro(r.totalCents / 100)}</div>
            <div style={{ fontSize: 11, color: r.paymentStatus === "paid" ? colors.greenText : colors.faint }}>{r.paymentStatus}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Profile (name / home county / notifications / accessibility / comfort / privacy, relocated unchanged) --

const NOTIFICATION_CATEGORIES: { key: keyof NotificationPrefs; label: string }[] = [
  { key: "bookingConfirmations", label: "Booking confirmations" },
  { key: "bookingReminders", label: "Booking reminders" },
  { key: "activityReminders", label: "Activity reminders" },
  { key: "waitlistOffers", label: "Waitlist offers" },
  { key: "openSpots", label: "Open spots nearby" },
  { key: "recommendations", label: "Recommendations" },
  { key: "circleAnnouncements", label: "Circle announcements" },
  { key: "intentMatches", label: "Matches for things you're interested in" },
  { key: "routineReminders", label: "Routine reminders" },
  { key: "marketing", label: "News and offers" },
];

function ProfileDetailsPanel() {
  const navigate = useNavigate();
  const { resident, refresh } = useGuest();
  const [name, setName] = useState(resident?.name ?? "");
  const [homeCounty, setHomeCounty] = useState(resident?.homeCounty ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    bookingConfirmations: true,
    bookingReminders: true,
    activityReminders: true,
    waitlistOffers: true,
    openSpots: true,
    recommendations: true,
    circleAnnouncements: true,
    routineReminders: true,
    marketing: false,
    intentMatches: true,
  });
  const [accessibility, setAccessibility] = useState<string[]>([]);
  const [hostStatus, setHostStatus] = useState<HostStatus>("none");
  const [hostBio, setHostBio] = useState("");
  const [hostPhone, setHostPhone] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [prefGroupSize, setPrefGroupSize] = useState("");
  const [prefBeginnerFriendly, setPrefBeginnerFriendly] = useState(false);
  const [prefSoloFriendly, setPrefSoloFriendly] = useState(false);
  const [prefBudget, setPrefBudget] = useState("");
  const [comfortSaving, setComfortSaving] = useState(false);
  const [hideFromFamiliarCount, setHideFromFamiliarCount] = useState(false);
  const [discoverableByName, setDiscoverableByName] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const loadProfile = () => {
    fetchResidentFull().then(({ resident: r }) => {
      if (!r) return;
      setName(r.name);
      setHomeCounty(r.homeCounty);
      setAccessibility(r.accessibilityPrefs);
      setHostStatus(r.hostStatus);
      setHostBio(r.hostBio);
      setHostPhone(r.hostPhone);
      setGoals(r.goals);
      setPrefGroupSize(r.prefGroupSize);
      setPrefBeginnerFriendly(r.prefBeginnerFriendly);
      setPrefSoloFriendly(r.prefSoloFriendly);
      setPrefBudget(r.prefBudget);
      setHideFromFamiliarCount(r.hideFromFamiliarCount);
      setDiscoverableByName(r.discoverableByName);
      setHasPassword(r.hasPassword);
      setNotifPrefs(
        r.notificationPrefs ?? {
          bookingConfirmations: true,
          bookingReminders: true,
          activityReminders: true,
          waitlistOffers: true,
          openSpots: true,
          recommendations: true,
          circleAnnouncements: true,
          routineReminders: true,
          marketing: false,
          intentMatches: true,
        }
      );
    });
  };

  useEffect(loadProfile, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateResidentMe({ name, homeCounty });
      await refresh();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const toggleNotifPref = async (key: keyof NotificationPrefs) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
    await saveNotificationPrefs(next);
  };

  const toggleAccessibility = async (opt: string) => {
    const next = accessibility.includes(opt) ? accessibility.filter((a) => a !== opt) : [...accessibility, opt];
    setAccessibility(next);
    await saveAccessibilityPrefs(next);
  };

  const toggleGoal = (opt: string) => {
    setGoals((gs) => (gs.includes(opt) ? gs.filter((g) => g !== opt) : [...gs, opt]));
  };

  const handleSaveComfort = async () => {
    setComfortSaving(true);
    try {
      await saveOnboarding({ goals, prefGroupSize, prefBeginnerFriendly, prefSoloFriendly, prefBudget });
    } finally {
      setComfortSaving(false);
    }
  };

  const toggleHideFromFamiliarCount = async () => {
    const next = !hideFromFamiliarCount;
    setHideFromFamiliarCount(next);
    await updatePrivacyPrefs({ hideFromFamiliarCount: next });
  };

  const toggleDiscoverableByName = async () => {
    const next = !discoverableByName;
    setDiscoverableByName(next);
    await updatePrivacyPrefs({ discoverableByName: next });
  };

  const handleSavePassword = async () => {
    setPwError(null);
    setPwSaved(false);
    if (newPassword.length < 8) {
      setPwError("Password must be at least 8 characters");
      return;
    }
    setPwSaving(true);
    try {
      await changeResidentPassword({ currentPassword: hasPassword ? currentPassword : undefined, newPassword });
      setHasPassword(true);
      setCurrentPassword("");
      setNewPassword("");
      setPwSaved(true);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Couldn't update your password");
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Home county</label>
            <input value={homeCounty} onChange={(e) => setHomeCounty(e.target.value)} style={inputStyle} />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </Button>
          <button onClick={() => navigate("/onboarding")} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>
            Revisit interests & availability
          </button>
        </div>
      </div>

      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Password</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>
          {hasPassword
            ? "Change your password below, or keep using email sign-in links instead — either always works."
            : "Optional — set a password so you don't have to wait on an email link next time. Sign-in links keep working either way."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hasPassword && (
            <div>
              <label style={labelStyle}>Current password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={inputStyle} />
            </div>
          )}
          <div>
            <label style={labelStyle}>{hasPassword ? "New password" : "Password"}</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} />
          </div>
          <Button onClick={handleSavePassword} disabled={pwSaving || !newPassword || (hasPassword && !currentPassword)}>
            {pwSaving ? "Saving…" : pwSaved ? "Saved" : hasPassword ? "Change password" : "Set password"}
          </Button>
          {pwError && <div style={{ color: colors.danger, fontSize: 12.5 }}>{pwError}</div>}
        </div>
      </div>

      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Notifications</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {NOTIFICATION_CATEGORIES.map((c) => (
            <label key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
              {c.label}
              <input type="checkbox" checked={notifPrefs[c.key] !== false} onChange={() => toggleNotifPref(c.key)} style={{ accentColor: colors.green }} />
            </label>
          ))}
        </div>
      </div>

      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Accessibility</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>Used to improve filtering — never shown to other participants.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ACCESSIBILITY_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => toggleAccessibility(opt)}
              style={{
                border: `1px solid ${accessibility.includes(opt) ? colors.green : colors.border}`,
                background: accessibility.includes(opt) ? colors.greenBg : colors.surface,
                color: accessibility.includes(opt) ? colors.greenText : colors.text,
                borderRadius: radius.pill, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Participation comfort</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>Set once during onboarding — edit any time here.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {GOAL_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => toggleGoal(opt)}
              style={{
                border: `1px solid ${goals.includes(opt) ? colors.green : colors.border}`,
                background: goals.includes(opt) ? colors.greenBg : colors.surface,
                color: goals.includes(opt) ? colors.greenText : colors.text,
                borderRadius: radius.pill, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Preferred group size</label>
            <select value={prefGroupSize} onChange={(e) => setPrefGroupSize(e.target.value)} style={inputStyle}>
              <option value="">No preference</option>
              {GROUP_SIZE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Budget</label>
            <select value={prefBudget} onChange={(e) => setPrefBudget(e.target.value)} style={inputStyle}>
              <option value="">No preference</option>
              {BUDGET_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
            Prefer beginner-friendly activities
            <input type="checkbox" checked={prefBeginnerFriendly} onChange={(e) => setPrefBeginnerFriendly(e.target.checked)} style={{ accentColor: colors.green }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
            Prefer solo-friendly activities
            <input type="checkbox" checked={prefSoloFriendly} onChange={(e) => setPrefSoloFriendly(e.target.checked)} style={{ accentColor: colors.green }} />
          </label>
        </div>
        <Button onClick={handleSaveComfort} disabled={comfortSaving}>{comfortSaving ? "Saving…" : "Save"}</Button>
      </div>

      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Privacy</div>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, marginTop: 10 }}>
          <span>Hide me from other people's "familiar faces" counts</span>
          <input type="checkbox" checked={hideFromFamiliarCount} onChange={toggleHideFromFamiliarCount} style={{ accentColor: colors.green }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, marginTop: 12 }}>
          <span>Let other residents find me by name when inviting to a Circle</span>
          <input type="checkbox" checked={discoverableByName} onChange={toggleDiscoverableByName} style={{ accentColor: colors.green }} />
        </label>
        <p style={{ fontSize: 12, color: colors.faint, margin: "8px 0 0" }}>Off by default. Only your name is ever shown — never your email or phone.</p>
      </div>

      <PaymentMethodsPanel />
      {resident && <HostDashboardPanel residentId={resident.id} />}
      <HostApplicationPanel hostStatus={hostStatus} hostBio={hostBio} hostPhone={hostPhone} onApplied={loadProfile} />
      <BecomeProviderPanel hostStatus={hostStatus} />
      <SearchAlertsPanel />
    </div>
  );
}

// --- Safety Centre (IA spec §13, relocated unchanged) -----------------------

function SafetyCentrePanel() {
  const [blocked, setBlocked] = useState<BlockedResident[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([fetchBlockedResidents(), fetchMyReports()])
      .then(([b, r]) => {
        setBlocked(b);
        setReports(r);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleUnblock = async (id: string) => {
    await unblockResident(id);
    setBlocked((rows) => rows.filter((b) => b.id !== id));
  };

  if (loading) return <RowSkeleton />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 520 }}>
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Blocked people</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>
          People you've blocked won't be suggested as familiar faces. Block someone from a Circle or Game's chat.
        </p>
        {blocked.length === 0 ? (
          <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: 0 }}>You haven't blocked anyone.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {blocked.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
                <span>{b.name}</span>
                <Button variant="ghost" onClick={() => handleUnblock(b.id)}>Unblock</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Your reports</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>Content or people you've reported, and their review status.</p>
        {reports.length === 0 ? (
          <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: 0 }}>You haven't reported anything.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reports.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13.5 }}>
                <span>{r.targetType} · {r.reason}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.status === "pending" ? colors.orangeDark : colors.greenText }}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Help & Support (IA spec §13, relocated unchanged) -----------------------

const HELP_FAQS: { q: string; a: string }[] = [
  { q: "How do I cancel a booking?", a: "Open Bookings in My Life, expand the booking, and use Cancel. Refund policy depends on the venue's own terms, shown at checkout." },
  { q: "How do I get my money back?", a: "Refunds are processed by the venue or club, not automatically. Contact them via the booking confirmation email, or reach out to us if you don't hear back." },
  { q: "What's a Circle?", a: "A Circle is an ongoing group around a shared activity — think a standing weekly game or class, organised by one of its own members, not a vendor." },
  { q: "How does Verified Host work?", a: "Any resident can host a Game or Circle. Applying for Verified Host — under Profile — gets your application reviewed by our team; approved hosts get a badge next to their name." },
  { q: "How do I report a problem?", a: "Use the report option wherever you see it — on a Circle, a review, or a chat. You can track the outcome in Safety Centre → Your reports." },
];

function HelpSupportPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
      {HELP_FAQS.map((f) => (
        <div key={f.q} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 6 }}>{f.q}</div>
          <div style={{ fontSize: 13.5, color: colors.mutedLight, lineHeight: 1.5 }}>{f.a}</div>
        </div>
      ))}
      <div style={{ background: colors.panel, borderRadius: 14, padding: "16px 18px", fontSize: 13.5, color: colors.muted }}>
        Still stuck? Email us at{" "}
        <a href="mailto:support@hellocircle.ie" style={{ color: colors.greenText, fontWeight: 700 }}>support@hellocircle.ie</a>.
      </div>
    </div>
  );
}

// --- Page shell --------------------------------------------------------

type ProfileTab = "profile" | "household" | "favourites" | "following" | "routines" | "notifications" | "passes" | "receipts" | "safety" | "help";

const PRIMARY_TABS: { key: ProfileTab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "household", label: "Household" },
];
const MORE_TABS: { key: ProfileTab; label: string }[] = [
  { key: "favourites", label: "Saved" },
  { key: "following", label: "Following" },
  { key: "routines", label: "Routines" },
  { key: "notifications", label: "Notifications" },
  { key: "passes", label: "Passes" },
  { key: "receipts", label: "Receipts" },
  { key: "safety", label: "Safety Centre" },
  { key: "help", label: "Help & Support" },
];

export function Profile() {
  const navigate = useNavigate();
  const { resident, loading: guestLoading } = useGuest();
  const [tab, setTab] = useState<ProfileTab>("profile");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  if (!guestLoading && !resident) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>Sign in to edit your profile.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>Profile, household, saved plans and settings live here once you're signed in.</p>
        <Button onClick={() => navigate(signInHref())}>Sign in</Button>
      </section>
    );
  }

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 80px" }}>
        <PageTitle style={{ margin: "0 0 20px" }}>Profile & settings</PageTitle>

        <div style={{ marginBottom: 24, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Tabs value={tab} onChange={setTab} options={PRIMARY_TABS} />
          <div style={{ position: "relative" }}>
            <button
              className={`tab-btn ${MORE_TABS.some((t) => t.key === tab) ? "tab-btn-active" : ""}`}
              onClick={() => setMoreMenuOpen((o) => !o)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4, borderRadius: radius.control, fontWeight: 700, fontSize: 14, padding: "9px 16px",
                background: MORE_TABS.some((t) => t.key === tab) ? colors.dark : colors.surface,
                color: MORE_TABS.some((t) => t.key === tab) ? "#fff" : colors.text,
                border: MORE_TABS.some((t) => t.key === tab) ? "none" : `1px solid ${colors.borderStrong}`,
              }}
            >
              More <ChevronRightIcon size={13} style={{ transform: moreMenuOpen ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
            </button>
            {moreMenuOpen && (
              <div
                className="pop-in"
                style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 30, minWidth: 180, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, boxShadow: "0 16px 36px rgba(30,40,32,.14)", padding: 8 }}
              >
                {MORE_TABS.map((t) => (
                  <button
                    key={t.key}
                    className="dropdown-item"
                    onClick={() => {
                      setTab(t.key);
                      setMoreMenuOpen(false);
                    }}
                    style={{
                      display: "block", width: "100%", background: t.key === tab ? colors.panel : "none", border: "none", borderRadius: radius.control,
                      padding: "10px 12px", fontSize: 14.5, fontWeight: t.key === tab ? 700 : 600, color: colors.text, textAlign: "left", cursor: "pointer",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {tab === "profile" && <ProfileDetailsPanel />}
        {tab === "household" && <HouseholdPanel />}
        {tab === "favourites" && <FavouritesPanel />}
        {tab === "following" && <FollowingPanel />}
        {tab === "routines" && <RoutinesPanel />}
        {tab === "notifications" && <NotificationsPanel />}
        {tab === "passes" && <PassesPanel />}
        {tab === "receipts" && <ReceiptsPanel />}
        {tab === "safety" && <SafetyCentrePanel />}
        {tab === "help" && <HelpSupportPanel />}
      </section>
    </div>
  );
}
