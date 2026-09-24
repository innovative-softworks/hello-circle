import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  addHouseholdMember,
  changeResidentPassword,
  createRoutine,
  deactivateAccount,
  deleteHouseholdMember,
  exportMyData,
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
  removeAvatar,
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
  uploadAvatar,
} from "../api";
import type { FollowedEntity, NotificationLevel } from "../api";
import {
  AwardIcon,
  BellIcon,
  BuildingIcon,
  CameraIcon,
  CardIcon,
  ChatIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClipboardIcon,
  EditIcon,
  EyeOffIcon,
  HeartIcon,
  IdCardIcon,
  LightbulbIcon,
  LockIcon,
  MailIcon,
  PersonIcon,
  PinIcon,
  RepeatIcon,
  ShieldIcon,
  TagIcon,
  UsersIcon,
} from "../components/icons";
import { HostApplicationPanel } from "../components/HostApplicationPanel";
import { BecomeProviderPanel } from "../components/BecomeProviderPanel";
import { ManageShell } from "../components/ManageShell";
import { PaymentMethodsPanel } from "../components/PaymentMethodsPanel";
import { Photo } from "../components/Photo";
import { SearchAlertsPanel } from "../components/SearchAlertsPanel";
import { Avatar, Button, ConfirmDialog, EmptyState, RowSkeleton, Switch, inputStyle, labelStyle } from "../components/ui";
import { signInHref } from "../authRedirect";
import { euro } from "../euro";
import { favouriteDetailHref } from "../favouriteLink";
import { useGuest } from "../GuestContext";
import { notificationHref } from "../notificationLink";
import { colors, fonts, radius } from "../theme";
import { ACCESSIBILITY_OPTIONS, AVAILABILITY_OPTIONS, BUDGET_OPTIONS, GOAL_OPTIONS, GROUP_SIZE_OPTIONS, INTEREST_OPTIONS } from "../types";
import type { BlockedResident, Favourite, HostStatus, HouseholdMember, NotificationPrefs, Pass, Receipt, ReportRecord, ResidentNotification, Routine, RoutineSuggestion } from "../types";

// Profile & settings (My Life redesign §46, restructured again in the
// dashboard-nav pass below) — split out of what used to be MyBookings.tsx's
// "More" tab menu. My Life itself (still served at /bookings — real
// magic-link emails point there, not renamed) is now a participation-first
// hub; account administration lives here instead.
//
// This page previously drove itself with a bespoke `Tabs` row plus a "More"
// dropdown hiding 8 of 10 sections, and dumped every account-settings
// concern (identity, password, 10 notification checkboxes, accessibility,
// participation comfort, privacy, payment methods, host application, become-
// a-provider, search alerts) into one `ProfileDetailsPanel` mega-component
// under a single "Profile" tab. It now reuses `ManageShell` — the same
// sticky-sidebar/mobile-drawer nav shell VendorDashboard.tsx/
// AdminDashboard.tsx already use — instead of reinventing a weaker nav
// pattern, and the old mega-component is split into one panel per concern so
// each gets its own place in that nav instead of one undifferentiated scroll.

// --- Identity banner ---------------------------------------------------

function ProfileIdentityBanner({ onEdit }: { onEdit: () => void }) {
  const { resident } = useGuest();
  if (!resident) return null;
  const memberSince = resident.createdAt
    ? new Date(resident.createdAt).toLocaleDateString("en-IE", { month: "long", year: "numeric" })
    : null;

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 20,
        padding: "20px 22px", marginBottom: 28,
      }}
    >
      <Avatar name={resident.name || "?"} src={resident.avatarUrl} size={56} />
      <div>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 21 }}>{resident.name}</div>
        <div style={{ fontSize: 13.5, color: colors.mutedLight, marginTop: 3 }}>
          {resident.email}
          {resident.homeCounty ? ` · ${resident.homeCounty}` : ""}
          {memberSince ? ` · Member since ${memberSince}` : ""}
        </div>
      </div>
      <div style={{ marginLeft: "auto" }}>
        <Button variant="ghost" onClick={onEdit}>Edit details</Button>
      </div>
    </div>
  );
}

/** Thumbnail + upload/change/remove controls for the profile photo —
 * lives in Profile details (Account, below) as an ordinary row, same
 * pattern as Name/Home county/Email, rather than as the banner's only
 * editing surface. The banner (above) just displays whatever this sets. */
function ProfilePhotoRow() {
  const { resident, refresh } = useGuest();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !resident) return;
    setError(null);
    setUploading(true);
    try {
      await uploadAvatar(file, resident.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that photo");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setError(null);
    setUploading(true);
    try {
      await removeAvatar();
      await refresh();
    } finally {
      setUploading(false);
    }
  };

  return (
    <SettingsRow
      icon={<CameraIcon size={15} />}
      label="Profile photo"
      description={error ?? "JPEG, PNG or WebP, up to 4MB"}
      control={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={resident?.name || "?"} src={resident?.avatarUrl} size={40} />
          <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : resident?.avatarUrl ? "Change" : "Upload"}
          </Button>
          {resident?.avatarUrl && (
            <Button variant="danger" onClick={handleRemove} disabled={uploading}>Remove</Button>
          )}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChosen} style={{ display: "none" }} />
        </div>
      }
    />
  );
}

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

  const [removeTarget, setRemoveTarget] = useState<HouseholdMember | null>(null);

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
              <Button variant="danger" onClick={() => setRemoveTarget(m)}>Remove</Button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!removeTarget}
        title={`Remove ${removeTarget?.firstName ?? "this member"}?`}
        message="You'll need to add them again to register for a club on their behalf."
        confirmLabel="Remove"
        onConfirm={() => {
          if (removeTarget) handleRemove(removeTarget.id);
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}

// --- Favourites / Saved (MVP, relocated unchanged) --------------------------

const FAVOURITE_LISTING_LABEL: Record<Favourite["listingType"], string> = {
  centre: "Community centre",
  club: "Sports club",
  game: "Session",
  program_session: "Program session",
  club_session: "Club session",
  experience: "Adventure / Experience",
  circle: "Circle",
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
            const detailHref = favouriteDetailHref(f);
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
              variant="thumbnail"
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

// --- Notification inbox (MVP, relocated unchanged; distinct from the
// notification-preference toggles in NotificationPrefsPanel below) ----------

function NotificationInboxPanel() {
  const navigate = useNavigate();
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

  // Resident Experience Polish — this panel previously never navigated
  // anywhere on click, for any notification kind — it only marked a row
  // read. Now opens the same place the matching native push already does
  // (see notificationLink.ts, mirroring notifications.ts's pushPathFor).
  const handleClick = (n: ResidentNotification) => {
    if (!n.read) handleRead(n.id);
    const href = notificationHref(n);
    if (href) navigate(href);
  };

  if (loading) return <RowSkeleton />;
  if (notifications.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="Nothing yet" subtitle="Bookings, registrations, waitlist offers and session updates will show up here." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {notifications.map((n) => (
        <div
          key={n.id}
          onClick={() => handleClick(n)}
          style={{
            background: n.read ? colors.surface : colors.greenBg,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            padding: "14px 18px",
            cursor: notificationHref(n) || !n.read ? "pointer" : "default",
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
  game: "Session",
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

// --- Flat settings row/section primitives ------------------------------
// A ChatGPT/Claude-style settings look: plain rows separated by a hairline,
// label (+ optional description) on the left and the control on the right —
// no per-group white card/border box. Local to this file rather than
// ui.tsx since no other page uses this exact layout yet.

function SettingsSection({ title, children, last }: { title?: string; children: ReactNode; last?: boolean }) {
  return (
    <div style={{ marginBottom: last ? 0 : 44 }}>
      {title && (
        <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: colors.faint, margin: "0 0 4px" }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  description,
  control,
  last,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
        padding: "16px 0", borderBottom: last ? "none" : `1px solid ${colors.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {icon && <span style={{ color: colors.faint, marginTop: 2, flex: "none" }}>{icon}</span>}
        <div>
          <div style={{ fontSize: 14.5 }}>{label}</div>
          {description && <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 3 }}>{description}</div>}
        </div>
      </div>
      <div style={{ flex: "none" }}>{control}</div>
    </div>
  );
}

/** A row's read-only value plus a small pencil-icon button to start editing
 * it in place — replaces a separate text "Edit"/"Change password" button
 * sitting off to the side. */
function EditableValue({ value, empty, onEdit, editLabel }: { value: ReactNode; empty?: boolean; onEdit: () => void; editLabel: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 14.5, color: empty ? colors.faint : colors.text, fontStyle: empty ? "italic" : "normal" }}>{value}</span>
      <button
        onClick={onEdit}
        aria-label={editLabel}
        title={editLabel}
        style={{ background: "none", border: "none", cursor: "pointer", color: colors.muted, padding: 5, borderRadius: 6, display: "flex" }}
      >
        <EditIcon size={14} />
      </button>
    </div>
  );
}

// --- Account details (name / home county / password) -----------------------
// Split out of the old ProfileDetailsPanel mega-component so it can be its
// own nav item instead of the top of one long scroll.

function AccountDetailsPanel() {
  const { resident, refresh } = useGuest();
  const [savedName, setSavedName] = useState("");
  const [savedCounty, setSavedCounty] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftCounty, setDraftCounty] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [saving, setSaving] = useState(false);

  const [hasPassword, setHasPassword] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    fetchResidentFull().then(({ resident: r }) => {
      if (!r) return;
      setSavedName(r.name);
      setSavedCounty(r.homeCounty);
      setHasPassword(r.hasPassword);
      setEmailVerified(r.emailVerified);
    });
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportMyData();
    } finally {
      setExporting(false);
    }
  };

  const handleDeactivate = async () => {
    setDeactivating(true);
    try {
      await deactivateAccount();
      window.location.href = "/";
    } finally {
      setDeactivating(false);
    }
  };

  const startEditingProfile = () => {
    setDraftName(savedName);
    setDraftCounty(savedCounty);
    setEditingProfile(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateResidentMe({ name: draftName, homeCounty: draftCounty });
      await refresh();
      setSavedName(draftName);
      setSavedCounty(draftCounty);
      setEditingProfile(false);
    } finally {
      setSaving(false);
    }
  };

  const startEditingPassword = () => {
    setCurrentPassword("");
    setNewPassword("");
    setPwError(null);
    setEditingPassword(true);
  };

  const handleSavePassword = async () => {
    setPwError(null);
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
      setEditingPassword(false);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Couldn't update your password");
    } finally {
      setPwSaving(false);
    }
  };

  const rowInputStyle: CSSProperties = { ...inputStyle, width: 260 };

  return (
    <div>
      <SettingsSection title="Profile">
        <ProfilePhotoRow />
        {editingProfile ? (
          <>
            <SettingsRow
              icon={<PersonIcon size={15} />}
              label="Name"
              control={<input value={draftName} onChange={(e) => setDraftName(e.target.value)} style={rowInputStyle} autoFocus />}
            />
            <SettingsRow
              icon={<PinIcon size={15} />}
              label="Home county"
              control={<input value={draftCounty} onChange={(e) => setDraftCounty(e.target.value)} style={rowInputStyle} />}
              last
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              <Button variant="ghost" onClick={() => setEditingProfile(false)} disabled={saving}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <SettingsRow
              icon={<PersonIcon size={15} />}
              label="Name"
              description="Your full display name"
              control={<EditableValue value={savedName || "Not set"} empty={!savedName} onEdit={startEditingProfile} editLabel="Edit name" />}
            />
            <SettingsRow
              icon={<PinIcon size={15} />}
              label="Home county"
              description="Used to show you what's nearby"
              control={<EditableValue value={savedCounty || "Not set"} empty={!savedCounty} onEdit={startEditingProfile} editLabel="Edit home county" />}
            />
            <SettingsRow
              icon={<MailIcon size={15} />}
              label="Email"
              description="Used to sign in — can't be changed here"
              control={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14.5, color: colors.text }}>{resident?.email}</span>
                  {emailVerified && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>
                      <CheckCircleIcon size={11} /> Verified
                    </span>
                  )}
                </div>
              }
              last
            />
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Password">
        {editingPassword ? (
          <>
            <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 4px" }}>
              {hasPassword ? "Enter your current password, then choose a new one." : "Set a password so you don't have to wait on an email link next time."}
            </p>
            {hasPassword && (
              <SettingsRow
                label="Current password"
                control={<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={rowInputStyle} autoFocus />}
              />
            )}
            <SettingsRow
              label={hasPassword ? "New password" : "Password"}
              control={<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={rowInputStyle} autoFocus={!hasPassword} />}
              last
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
              <Button onClick={handleSavePassword} disabled={pwSaving || !newPassword || (hasPassword && !currentPassword)}>
                {pwSaving ? "Saving…" : hasPassword ? "Change password" : "Set password"}
              </Button>
              <Button variant="ghost" onClick={() => setEditingPassword(false)} disabled={pwSaving}>Cancel</Button>
            </div>
            {pwError && <div style={{ color: colors.danger, fontSize: 12.5, marginTop: 8 }}>{pwError}</div>}
          </>
        ) : (
          <SettingsRow
            icon={<LockIcon size={15} />}
            label="Password"
            description={hasPassword ? "Sign in with either your password or an email link — either always works." : "Not set — you sign in with an email link instead."}
            control={
              <EditableValue
                value={hasPassword ? "••••••••" : "Not set"}
                empty={!hasPassword}
                onEdit={startEditingPassword}
                editLabel={hasPassword ? "Change password" : "Set password"}
              />
            }
            last
          />
        )}
      </SettingsSection>

      <SettingsSection title="Your data" last>
        <SettingsRow
          label="Download my data"
          description="A copy of your profile, household, favourites, notifications and safety-centre history as a JSON file"
          control={<Button variant="ghost" onClick={handleExport} disabled={exporting}>{exporting ? "Preparing…" : "Download"}</Button>}
        />
        <SettingsRow
          label="Deactivate account"
          description="Hides you from familiar-faces counts and Circle invites. Signing back in with your email reactivates it — nothing is deleted."
          control={<Button variant="danger" onClick={() => setConfirmDeactivate(true)}>Deactivate</Button>}
          last
        />
      </SettingsSection>

      <ConfirmDialog
        open={confirmDeactivate}
        title="Deactivate your account?"
        message="You'll be signed out, and hidden from familiar-faces counts and Circle invites. Nothing is deleted — signing back in with this email reactivates your account exactly as it was."
        confirmLabel={deactivating ? "Deactivating…" : "Deactivate"}
        tone="danger"
        busy={deactivating}
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </div>
  );
}

// --- Notification preferences (split out of ProfileDetailsPanel) -----------
// Distinct from NotificationInboxPanel above — this is what triggers each
// email, not the received messages themselves.

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
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
};

const NOTIFICATION_GROUPS: { label: string; items: { key: keyof NotificationPrefs; label: string; description: string }[] }[] = [
  {
    label: "Bookings & activity",
    items: [
      { key: "bookingConfirmations", label: "Booking confirmations", description: "Email when a booking or registration is confirmed" },
      { key: "bookingReminders", label: "Booking reminders", description: "A reminder before an upcoming booking" },
      { key: "activityReminders", label: "Activity reminders", description: "A reminder before a Circle, Session or Program session you've joined" },
      { key: "routineReminders", label: "Routine reminders", description: "A nudge when it's time for one of your routines" },
    ],
  },
  {
    label: "Discovery",
    items: [
      { key: "waitlistOffers", label: "Waitlist offers", description: "When a spot opens up on a waitlist you're on" },
      { key: "openSpots", label: "Open spots nearby", description: "New availability at centres and clubs near you" },
      { key: "recommendations", label: "Recommendations", description: "Occasional suggestions based on what you've done before" },
      { key: "intentMatches", label: "Matches for things you're interested in", description: "When something matching your interests appears nearby" },
    ],
  },
  { label: "Community", items: [{ key: "circleAnnouncements", label: "Circle announcements", description: "Updates posted by a Circle you're a member of" }] },
  { label: "Marketing", items: [{ key: "marketing", label: "News and offers", description: "Product updates and promotions from HelloCircle" }] },
];

function NotificationPrefsPanel() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResidentFull()
      .then(({ resident: r }) => {
        if (r?.notificationPrefs) setPrefs(r.notificationPrefs);
      })
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (key: keyof NotificationPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await saveNotificationPrefs(next);
  };

  if (loading) return <RowSkeleton />;

  return (
    <div>
      {NOTIFICATION_GROUPS.map((group, i) => (
        <SettingsSection key={group.label} title={group.label} last={i === NOTIFICATION_GROUPS.length - 1}>
          {group.items.map((it, j) => (
            <SettingsRow
              key={it.key}
              label={it.label}
              description={it.description}
              control={<Switch checked={prefs[it.key] !== false} onChange={() => toggle(it.key)} label={it.label} />}
              last={j === group.items.length - 1}
            />
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}

// --- Participation preferences (split out of ProfileDetailsPanel) ----------
// The "Participation comfort" set from onboarding — goals, group size,
// budget, beginner/solo-friendliness. Distinct from PrivacyAccessibilityPanel
// below (that one is about who can see/find you, not what you like doing).

const RADIUS_OPTIONS_KM = [2, 5, 10, 20];

function ParticipationPreferencesPanel() {
  const [interests, setInterests] = useState<string[]>([]);
  const [availability, setAvailability] = useState<string[]>([]);
  const [searchRadiusKm, setSearchRadiusKm] = useState(5);
  const [goals, setGoals] = useState<string[]>([]);
  const [prefGroupSize, setPrefGroupSize] = useState("");
  const [prefBudget, setPrefBudget] = useState("");
  const [prefBeginnerFriendly, setPrefBeginnerFriendly] = useState(false);
  const [prefSoloFriendly, setPrefSoloFriendly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchResidentFull()
      .then(({ resident: r }) => {
        if (!r) return;
        setInterests(r.interests);
        setAvailability(r.availability);
        setSearchRadiusKm(r.searchRadiusKm || 5);
        setGoals(r.goals);
        setPrefGroupSize(r.prefGroupSize);
        setPrefBudget(r.prefBudget);
        setPrefBeginnerFriendly(r.prefBeginnerFriendly);
        setPrefSoloFriendly(r.prefSoloFriendly);
      })
      .finally(() => setLoading(false));
  }, []);

  const toggleIn = (list: string[], setList: (v: string[]) => void, opt: string) => {
    setList(list.includes(opt) ? list.filter((v) => v !== opt) : [...list, opt]);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveOnboarding({ interests, availability, searchRadiusKm, goals, prefGroupSize, prefBeginnerFriendly, prefSoloFriendly, prefBudget });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <RowSkeleton />;

  const rowSelectStyle: CSSProperties = { ...inputStyle, width: 200 };
  const tagStyle = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? colors.green : colors.border}`,
    background: active ? colors.greenBg : colors.surface,
    color: active ? colors.greenText : colors.text,
    borderRadius: radius.pill, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
  });

  return (
    <div>
      <SettingsSection title="What you're into">
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>Drives what shows up on Explore and in recommendations.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {INTEREST_OPTIONS.map((opt) => (
            <button key={opt} onClick={() => toggleIn(interests, setInterests, opt)} style={tagStyle(interests.includes(opt))}>{opt}</button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="When you're usually free">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {AVAILABILITY_OPTIONS.map((opt) => (
            <button key={opt} onClick={() => toggleIn(availability, setAvailability, opt)} style={tagStyle(availability.includes(opt))}>{opt}</button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Discover things within">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {RADIUS_OPTIONS_KM.map((km) => (
            <button key={km} onClick={() => setSearchRadiusKm(km)} style={tagStyle(searchRadiusKm === km)}>{km} km</button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Goals">
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>What you'd like HelloCircle to help with right now.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {GOAL_OPTIONS.map((opt) => (
            <button key={opt} onClick={() => toggleIn(goals, setGoals, opt)} style={tagStyle(goals.includes(opt))}>{opt}</button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="How you like to take part" last>
        <SettingsRow
          label="Preferred group size"
          description="Weight search results and recommendations toward this group size"
          control={
            <select value={prefGroupSize} onChange={(e) => setPrefGroupSize(e.target.value)} style={rowSelectStyle}>
              <option value="">No preference</option>
              {GROUP_SIZE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label="Budget"
          description="Weight results toward activities in this price range"
          control={
            <select value={prefBudget} onChange={(e) => setPrefBudget(e.target.value)} style={rowSelectStyle}>
              <option value="">No preference</option>
              {BUDGET_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label="Prefer beginner-friendly activities"
          description="Favour activities that welcome people trying something for the first time"
          control={<Switch checked={prefBeginnerFriendly} onChange={() => setPrefBeginnerFriendly((v) => !v)} label="Prefer beginner-friendly activities" />}
        />
        <SettingsRow
          label="Prefer solo-friendly activities"
          description="Favour activities that work well on your own, not just in a group"
          control={<Switch checked={prefSoloFriendly} onChange={() => setPrefSoloFriendly((v) => !v)} label="Prefer solo-friendly activities" />}
          last
        />
        <div style={{ marginTop: 16 }}>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : saved ? "Saved" : "Save"}</Button>
        </div>
      </SettingsSection>
    </div>
  );
}

// --- Privacy & accessibility (split out of ProfileDetailsPanel) ------------

function PrivacyAccessibilityPanel() {
  const [accessibility, setAccessibility] = useState<string[]>([]);
  const [hideFromFamiliarCount, setHideFromFamiliarCount] = useState(false);
  const [discoverableByName, setDiscoverableByName] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResidentFull()
      .then(({ resident: r }) => {
        if (!r) return;
        setAccessibility(r.accessibilityPrefs);
        setHideFromFamiliarCount(r.hideFromFamiliarCount);
        setDiscoverableByName(r.discoverableByName);
      })
      .finally(() => setLoading(false));
  }, []);

  const toggleAccessibility = async (opt: string) => {
    const next = accessibility.includes(opt) ? accessibility.filter((a) => a !== opt) : [...accessibility, opt];
    setAccessibility(next);
    await saveAccessibilityPrefs(next);
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

  if (loading) return <RowSkeleton />;

  return (
    <div>
      <SettingsSection title="Accessibility">
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
      </SettingsSection>

      <SettingsSection title="Who can find you" last>
        <SettingsRow
          label="Hide from familiar faces"
          description="Other residents won't see you counted among the people they've been to things with"
          control={<Switch checked={hideFromFamiliarCount} onChange={toggleHideFromFamiliarCount} label="Hide me from other people's familiar faces counts" />}
        />
        <SettingsRow
          label="Discoverable by name"
          description="Lets someone searching by name find and invite you to a Circle"
          control={<Switch checked={discoverableByName} onChange={toggleDiscoverableByName} label="Let other residents find me by name when inviting to a Circle" />}
          last
        />
        <p style={{ fontSize: 12, color: colors.faint, margin: "12px 0 0" }}>Off by default. Only your name is ever shown — never your email or phone.</p>
      </SettingsSection>
    </div>
  );
}

// --- Hosting (host application + host dashboard + become-a-provider +
// search alerts — relocated unchanged from the bottom of the old
// ProfileDetailsPanel scroll into their own nav item) ------------------------

function HostingPanel() {
  const navigate = useNavigate();
  const [hostStatus, setHostStatus] = useState<HostStatus>("none");
  const [hostBio, setHostBio] = useState("");
  const [hostPhone, setHostPhone] = useState("");

  const load = () => {
    fetchResidentFull().then(({ resident: r }) => {
      if (!r) return;
      setHostStatus(r.hostStatus);
      setHostBio(r.hostBio);
      setHostPhone(r.hostPhone);
    });
  };

  useEffect(load, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* The full "my hosted activities" list now lives on the Manage
          dashboard (ManageHome.tsx, /manage) alongside the rest of a host's
          management surface — this just links out instead of keeping a
          second copy of that list here. Shown regardless of hostStatus:
          hosting a Game/Circle never required applying for the Verified
          Host badge, so someone who's hosted but never applied still needs
          a way in — /manage's own empty states cover a resident who's
          hosted nothing yet. */}
      <Button variant="ghost" onClick={() => navigate("/manage")}>Go to your Hosting dashboard →</Button>
      <HostApplicationPanel hostStatus={hostStatus} hostBio={hostBio} hostPhone={hostPhone} onApplied={load} />
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
    <div>
      <SettingsSection title="Blocked people">
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 4px" }}>
          People you've blocked won't be suggested as familiar faces. Block someone from a Circle or Game's chat.
        </p>
        {blocked.length === 0 ? (
          <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: "12px 0 0" }}>You haven't blocked anyone.</p>
        ) : (
          blocked.map((b, i) => (
            <SettingsRow
              key={b.id}
              label={b.name}
              control={<Button variant="ghost" onClick={() => handleUnblock(b.id)}>Unblock</Button>}
              last={i === blocked.length - 1}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title="Your reports" last>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 4px" }}>Content or people you've reported, and their review status.</p>
        {reports.length === 0 ? (
          <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: "12px 0 0" }}>You haven't reported anything.</p>
        ) : (
          reports.map((r, i) => (
            <SettingsRow
              key={r.id}
              label={`${r.targetType} · ${r.reason}`}
              control={
                <span style={{ fontSize: 12, fontWeight: 700, color: r.status === "pending" ? colors.orangeDark : colors.greenText }}>{r.status}</span>
              }
              last={i === reports.length - 1}
            />
          ))
        )}
      </SettingsSection>
    </div>
  );
}

// --- Help & Support (IA spec §13, relocated unchanged) -----------------------

const HELP_FAQS: { q: string; a: string }[] = [
  { q: "How do I cancel a booking?", a: "Open Bookings in My Life, expand the booking, and use Cancel. Refund policy depends on the venue's own terms, shown at checkout." },
  { q: "How do I get my money back?", a: "Refunds are processed by the venue or club, not automatically. Contact them via the booking confirmation email, or reach out to us if you don't hear back." },
  { q: "What's a Circle?", a: "A Circle is an ongoing group around a shared activity — think a standing weekly session or class, organised by one of its own members, not a vendor." },
  { q: "How does Verified Host work?", a: "Any resident can host a Session or Circle. Applying for Verified Host — under Profile — gets your application reviewed by our team; approved hosts get a badge next to their name." },
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

type ProfileSection =
  | "account" | "notificationPrefs" | "preferences" | "privacy" | "payment"
  | "household" | "favourites" | "following" | "routines" | "passes" | "receipts" | "inbox"
  | "hosting"
  | "safety" | "help";

const NAV_OPTIONS: { key: ProfileSection; label: string; icon: ReactNode; group: string }[] = [
  { key: "account", label: "Profile details", icon: <IdCardIcon size={15} />, group: "Account" },
  { key: "notificationPrefs", label: "Notification settings", icon: <MailIcon size={15} />, group: "Account" },
  { key: "preferences", label: "Interests & Discovery", icon: <LightbulbIcon size={15} />, group: "Account" },
  { key: "privacy", label: "Privacy & accessibility", icon: <EyeOffIcon size={15} />, group: "Account" },
  { key: "payment", label: "Payment methods", icon: <CardIcon size={15} />, group: "Account" },

  { key: "household", label: "Household", icon: <UsersIcon size={15} />, group: "Household & plans" },
  { key: "favourites", label: "Saved", icon: <HeartIcon size={15} />, group: "Household & plans" },
  { key: "following", label: "Following", icon: <PersonIcon size={15} />, group: "Household & plans" },
  { key: "routines", label: "Routines", icon: <RepeatIcon size={15} />, group: "Household & plans" },
  { key: "passes", label: "Passes", icon: <TagIcon size={15} />, group: "Household & plans" },
  { key: "receipts", label: "Receipts", icon: <ClipboardIcon size={15} />, group: "Household & plans" },
  { key: "inbox", label: "Notifications", icon: <BellIcon size={15} />, group: "Household & plans" },

  { key: "hosting", label: "Become a host", icon: <AwardIcon size={15} />, group: "Hosting" },

  { key: "safety", label: "Safety Centre", icon: <ShieldIcon size={15} />, group: "Support" },
  { key: "help", label: "Help & Support", icon: <ChatIcon size={15} />, group: "Support" },
];

export function Profile() {
  const navigate = useNavigate();
  const { resident, loading: guestLoading } = useGuest();
  const [section, setSection] = useState<ProfileSection>("account");

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
    <ManageShell
      navTitle="Profile & settings"
      navOptions={NAV_OPTIONS}
      activeKey={section}
      onNavChange={setSection}
      pageTitle={NAV_OPTIONS.find((o) => o.key === section)?.label}
      banner={<ProfileIdentityBanner onEdit={() => setSection("account")} />}
      showNavLogo={false}
    >
      {section === "account" && <AccountDetailsPanel />}
      {section === "notificationPrefs" && <NotificationPrefsPanel />}
      {section === "preferences" && <ParticipationPreferencesPanel />}
      {section === "privacy" && <PrivacyAccessibilityPanel />}
      {section === "payment" && <PaymentMethodsPanel />}
      {section === "household" && <HouseholdPanel />}
      {section === "favourites" && <FavouritesPanel />}
      {section === "following" && <FollowingPanel />}
      {section === "routines" && <RoutinesPanel />}
      {section === "passes" && <PassesPanel />}
      {section === "receipts" && <ReceiptsPanel />}
      {section === "inbox" && <NotificationInboxPanel />}
      {section === "hosting" && <HostingPanel />}
      {section === "safety" && <SafetyCentrePanel />}
      {section === "help" && <HelpSupportPanel />}
    </ManageShell>
  );
}
