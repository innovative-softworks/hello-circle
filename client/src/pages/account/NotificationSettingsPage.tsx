import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BellOff, CheckCircle2 } from "lucide-react";
import { deleteSearchAlert, fetchSearchAlerts, saveNotificationPrefs, setSearchAlertActive } from "../../api";
import { useConfirm } from "../../components/ConfirmProvider";
import { useExperienceFeatures } from "../../circleFeatures";
import { useToast } from "../../components/Toast";
import { Button, LoadErrorState, RowSkeleton, Switch } from "../../components/ui";
import type { NotificationPrefs, SearchAlert } from "../../types";
import { accountHref } from "./accountSections";
import { AccountPage, AccountSection, Note, SettingRow, SettingRows, StatusTag, TextButton } from "./accountUi";
import { useResidentFull } from "./useResidentFull";

// Notification settings, honest version (owner decision 2026-10-24, audit
// A-01..A-03). Only four preferences are read by the server today:
// waitlistOffers, intentMatches and reviewInvites (server/src/notifications.ts
// PREF_KEY_BY_KIND, waitlist.ts) and the marketing consent. Every other
// resident notification is always sent, and one switch covers in-app, push
// and (for waitlists) email together — there are no per-channel settings, so
// none are shown. The other saved keys are kept untouched on save
// (PUT replaces the whole object).

const DEFAULTS: NotificationPrefs = {
  bookingConfirmations: true, bookingReminders: true, activityReminders: true, waitlistOffers: true, openSpots: true,
  recommendations: true, circleAnnouncements: true, routineReminders: true, marketing: false, intentMatches: true,
  savedAvailability: false, routineAlerts: false, reviewInvites: true,
};

const OPTIONAL: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  { key: "waitlistOffers", label: "Waitlist places", description: "When a place opens up on a waitlist you've joined. Sent by email, in the app and to your phone." },
  { key: "intentMatches", label: "Matches for things you want to do", description: "When something new nearby matches an activity you said you're looking for." },
  { key: "reviewInvites", label: "Review invitations", description: "One message after an organiser confirms you attended, inviting you to review it. In the app only." },
];

// Restored (owner 2026-10-24: "add all"). These are saved, but nothing on the
// server reads them yet (audit A-01), so the section says so plainly rather
// than implying they change what's sent.
const SAVED_ONLY: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  { key: "bookingConfirmations", label: "Booking confirmations", description: "Email when a booking or registration is confirmed." },
  { key: "bookingReminders", label: "Booking reminders", description: "A reminder before an upcoming booking." },
  { key: "activityReminders", label: "Activity reminders", description: "A reminder before a Circle, Session or programme session you've joined." },
  { key: "openSpots", label: "Open spots nearby", description: "New availability at centres and clubs near you." },
  { key: "recommendations", label: "Recommendations", description: "Occasional suggestions based on what you've done before." },
  { key: "circleAnnouncements", label: "Circle announcements", description: "Updates posted by a Circle you're a member of." },
];

const ALWAYS = [
  "Confirmations for bookings, registrations and tickets",
  "Changes, cancellations and refunds for things you've joined",
  "Circle invitations and updates from Circles you're in",
  "Messages about your account, host application or a report you made",
];

function describeAlert(a: SearchAlert): string {
  const parts = [a.county, a.keywords, a.mood ? `mood: ${a.mood}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Any new session";
}

function SavedAlerts() {
  const confirm = useConfirm();
  const toast = useToast();
  const [alerts, setAlerts] = useState<SearchAlert[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    fetchSearchAlerts().then(setAlerts).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const toggle = async (a: SearchAlert) => {
    setAlerts((rows) => rows && rows.map((r) => (r.id === a.id ? { ...r, active: a.active ? 0 : 1 } : r)));
    try {
      await setSearchAlertActive(a.id, !a.active);
    } catch {
      setAlerts((rows) => rows && rows.map((r) => (r.id === a.id ? a : r)));
      toast.error("That alert wasn't changed. Try again.");
    }
  };
  const remove = async (a: SearchAlert) => {
    const ok = await confirm({ title: "Delete this alert?", message: "You'll stop hearing about new activities that match it. Pause it instead if you might want it back.", confirmLabel: "Delete alert", tone: "danger" });
    if (!ok) return;
    try {
      await deleteSearchAlert(a.id);
      setAlerts((rows) => rows && rows.filter((r) => r.id !== a.id));
      toast.success("Alert deleted");
    } catch {
      toast.error("That alert wasn't deleted. Try again.");
    }
  };

  return (
    <AccountSection title="Search alerts" description="Alerts you set up from a search on Explore.">
      {failed ? (
        <LoadErrorState title="We couldn't load your alerts." onRetry={load} />
      ) : alerts === null ? (
        <RowSkeleton />
      ) : alerts.length === 0 ? (
        <p className="acct-row-desc" style={{ margin: 0 }}>
          You haven't set up any. Search on <Link to="/explore" style={{ color: "inherit", fontWeight: 700 }}>Explore</Link> and choose “Notify me about new sessions like this”.
        </p>
      ) : (
        <SettingRows>
          {alerts.map((a) => (
            <SettingRow
              key={a.id}
              label={describeAlert(a)}
              description={<StatusTag tone={a.active ? "ok" : "muted"}>{a.active ? "On" : "Paused"}</StatusTag>}
              control={
                <>
                  <Button variant="ghost" onClick={() => toggle(a)}>{a.active ? "Pause" : "Resume"}</Button>
                  <TextButton danger onClick={() => remove(a)} aria-label={`Delete alert ${describeAlert(a)}`}>Delete</TextButton>
                </>
              }
            />
          ))}
        </SettingRows>
      )}
    </AccountSection>
  );
}

export function NotificationSettingsPage() {
  const toast = useToast();
  const { data, loading, failed, reload } = useResidentFull();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULTS);
  const alertsOn = useExperienceFeatures()["mylife.alerts"];

  useEffect(() => {
    if (data) setPrefs({ ...DEFAULTS, ...(data.notificationPrefs ?? {}) });
  }, [data]);

  const toggle = async (key: keyof NotificationPrefs) => {
    const before = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      await saveNotificationPrefs(next);
      toast.success("Saved");
    } catch {
      setPrefs(before);
      toast.error("That setting wasn't saved. Try again.");
    }
  };

  return (
    <AccountPage eyebrow="Account" title="Notification settings" lede="Choose what we tell you about. Anything about a booking or plan you've made always comes through." narrow>
      {loading ? (
        <RowSkeleton />
      ) : failed || !data ? (
        <LoadErrorState title="We couldn't load your notification settings." onRetry={reload} />
      ) : (
        <>
          <AccountSection title="Always sent" description="These are part of using HelloCircle, so they can't be turned off.">
            <ul className="acct-list">
              {ALWAYS.map((a) => (
                <li key={a} className="acct-item" style={{ minHeight: 52 }}>
                  <CheckCircle2 size={18} aria-hidden="true" style={{ color: "var(--color-green-text)", flex: "none" }} />
                  <span style={{ fontSize: 14.5 }}>{a}</span>
                </li>
              ))}
            </ul>
          </AccountSection>

          <AccountSection title="You choose" description="Each switch covers every way we'd reach you: email, the app and your phone.">
            <SettingRows>
              {OPTIONAL.map((o) => (
                <SettingRow key={o.key} label={o.label} description={o.description} control={<Switch checked={prefs[o.key] !== false} onChange={() => toggle(o.key)} label={o.label} />} />
              ))}
              {/* My Life 3.0 (D5): opt-in, off unless turned on; only while mylife.alerts is on. */}
              {alertsOn && (
                <>
                  <SettingRow
                    label="New sessions for things you saved"
                    description="A note in the app when something you saved gets a new session. Off unless you turn it on."
                    control={<Switch checked={prefs.savedAvailability === true} onChange={() => toggle("savedAvailability")} label="New sessions for things you saved" />}
                  />
                  <SettingRow
                    label="Routine reminders"
                    description="The evening before a routine day, a note in the app if sessions fit it. Routines never book for you. Off unless you turn it on."
                    control={<Switch checked={prefs.routineAlerts === true} onChange={() => toggle("routineAlerts")} label="Routine reminders" />}
                  />
                </>
              )}
              <SettingRow
                label="News and offers"
                description="Occasional emails about new features and offers from HelloCircle. Off unless you turn it on."
                control={<Switch checked={prefs.marketing === true} onChange={() => toggle("marketing")} label="News and offers" />}
              />
            </SettingRows>
          </AccountSection>

          <AccountSection
            title="More preferences"
            description="We save these choices, but they don't change what we send yet. Booking confirmations and changes to your plans are always sent."
          >
            <SettingRows>
              {SAVED_ONLY.map((o) => (
                <SettingRow key={o.key} label={o.label} description={o.description} control={<Switch checked={prefs[o.key] !== false} onChange={() => toggle(o.key)} label={o.label} />} />
              ))}
            </SettingRows>
          </AccountSection>

          <AccountSection title="People you follow">
            <SettingRows>
              <SettingRow
                label="Updates from hosts, providers and venues"
                description="Choose highlights or everything for each one you follow."
                control={
                  <Link className="acct-text-btn" to={"/bookings?tab=saved&show=following"}>
                    Following <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                }
              />
            </SettingRows>
          </AccountSection>

          <SavedAlerts />

          <AccountSection>
            <Note icon={<BellOff size={16} aria-hidden="true" />}>
              Phone notifications also follow your phone's own settings. If you've turned HelloCircle off there, you'll still see everything in your{" "}
              <Link to={accountHref("inbox")} style={{ color: "inherit", fontWeight: 700 }}>notifications</Link>.
            </Note>
          </AccountSection>
        </>
      )}
    </AccountPage>
  );
}
