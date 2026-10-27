import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing, CalendarCheck, CheckCheck, Clock, Mail, ShieldCheck, Sparkles, Ticket, UsersRound, type LucideIcon } from "lucide-react";
import { fetchResidentNotificationsPage, markResidentNotificationRead } from "../../api";
import { useToast } from "../../components/Toast";
import { Button, LoadErrorState, LoadMoreControl, RowSkeleton } from "../../components/ui";
import { notificationHref } from "../../notificationLink";
import type { ResidentNotification } from "../../types";
import { useUrlParam } from "../../useUrlTab";
import { accountHref } from "./accountSections";
import { AccountEmpty, AccountPage, SegmentedTabs, dayBucket } from "./accountUi";

const KIND_ICON: Partial<Record<ResidentNotification["kind"], LucideIcon>> = {
  booking: CalendarCheck,
  registration: CalendarCheck,
  program: CalendarCheck,
  experience: Ticket,
  waitlist: Clock,
  game: Sparkles,
  intent_match: Sparkles,
  circle: UsersRound,
  invite: Mail,
  invite_withdrawn: Mail,
  moderation: ShieldCheck,
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const bucket = dayBucket(iso);
  if (bucket === "Today" || bucket === "Yesterday") return d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-IE", { weekday: bucket === "This week" ? "long" : undefined, day: "numeric", month: "short" });
}

export function InboxPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<ResidentNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [view, setView] = useUrlParam<"all" | "unread">("view", "all");

  const load = () => {
    setFailed(false);
    setItems(null);
    fetchResidentNotificationsPage()
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    fetchResidentNotificationsPage(nextCursor)
      .then((page) => {
        setItems((prev) => {
          const ids = new Set((prev ?? []).map((n) => n.id));
          return [...(prev ?? []), ...page.items.filter((n) => !ids.has(n.id))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch(() => setLoadMoreFailed(true))
      .finally(() => setLoadingMore(false));
  };

  const markRead = (id: number) => {
    setItems((rows) => rows && rows.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
    markResidentNotificationRead(id).catch(() => setItems((rows) => rows && rows.map((n) => (n.id === id ? { ...n, read: 0 } : n))));
  };

  const all = items ?? [];
  const unread = all.filter((n) => !n.read);

  // There is no "mark all" endpoint: this marks the loaded unread ones.
  const markAll = async () => {
    setMarkingAll(true);
    const ids = unread.map((n) => n.id);
    const results = await Promise.allSettled(ids.map((id) => markResidentNotificationRead(id)));
    const done = new Set(ids.filter((_, i) => results[i].status === "fulfilled"));
    setItems((rows) => rows && rows.map((n) => (done.has(n.id) ? { ...n, read: 1 } : n)));
    setMarkingAll(false);
    if (done.size < ids.length) toast.error("Some notifications weren't marked as read. Try again.");
    else toast.success("All caught up");
  };

  const shown = view === "unread" ? unread : all;
  const groups = useMemo(() => {
    const out: { label: string; items: ResidentNotification[] }[] = [];
    for (const n of shown) {
      const label = dayBucket(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [shown]);

  const open = (n: ResidentNotification) => {
    if (!n.read) markRead(n.id);
    const href = notificationHref(n);
    if (href) navigate(href);
  };

  return (
    <AccountPage
      eyebrow="My Life"
      title="Notifications"
      lede="Updates about your bookings, Circles and plans."
      actions={
        <>
          {unread.length > 0 && (
            <Button variant="ghost" onClick={markAll} disabled={markingAll} aria-busy={markingAll}>
              <CheckCheck size={16} aria-hidden="true" /> {markingAll ? "Marking…" : "Mark all as read"}
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate(accountHref("notificationPrefs"))}>
            <BellRing size={16} aria-hidden="true" /> Settings
          </Button>
        </>
      }
    >
      {failed ? (
        <LoadErrorState title="We couldn't load your notifications." onRetry={load} />
      ) : items === null ? (
        <div style={{ marginTop: 24 }}><RowSkeleton /></div>
      ) : items.length === 0 ? (
        <AccountEmpty icon={<Bell size={20} aria-hidden="true" />} title="Nothing yet">
          Booking confirmations, waitlist places, Circle invitations and session changes will show up here.
        </AccountEmpty>
      ) : (
        <>
          <div style={{ marginTop: 18 }}>
            <SegmentedTabs
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { key: "all", label: "All" },
                { key: "unread", label: "Unread", count: unread.length },
              ]}
            />
          </div>
          {shown.length === 0 ? (
            <AccountEmpty icon={<CheckCheck size={20} aria-hidden="true" />} title="You're all caught up" action={<Button variant="ghost" onClick={() => setView("all")}>Show all</Button>} />
          ) : (
            groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h2 className="acct-group-label">{g.label}</h2>
                <ul className="acct-list" aria-label={`${g.label} notifications`}>
                  {g.items.map((n) => {
                    const Icon = KIND_ICON[n.kind] ?? Bell;
                    const href = notificationHref(n);
                    const body = (
                      <>
                        <span className="acct-thumb acct-thumb--round" aria-hidden="true" style={{ position: "relative" }}>
                          <Icon size={18} />
                          {!n.read && <span style={{ position: "absolute", top: 2, right: 2, width: 10, height: 10, borderRadius: "50%", background: "var(--color-brand)", border: "2px solid var(--color-bg)" }} />}
                        </span>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span className="acct-item-title" style={{ display: "block", fontWeight: n.read ? 600 : 800 }}>
                            {!n.read && <span className="acct-sr">Unread: </span>}
                            {n.title}
                          </span>
                          <span className="acct-item-meta" style={{ display: "block", color: n.read ? undefined : "var(--color-text-soft)" }}>{n.body}</span>
                        </span>
                        <span className="acct-item-meta" style={{ flex: "none", alignSelf: "flex-start", marginTop: 2 }}>{timeLabel(n.createdAt)}</span>
                      </>
                    );
                    return (
                      <li key={n.id} className="acct-item" style={{ alignItems: "flex-start" }}>
                        {href ? (
                          <button type="button" className="acct-item-main" style={{ alignItems: "flex-start" }} onClick={() => open(n)}>
                            {body}
                          </button>
                        ) : (
                          <div className="acct-item-main" style={{ alignItems: "flex-start", cursor: "default" }}>
                            {body}
                          </div>
                        )}
                        {!href && !n.read && (
                          <div className="acct-item-side">
                            <button type="button" className="acct-text-btn" onClick={() => markRead(n.id)}>Mark as read</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
          {nextCursor && (
            <div style={{ marginTop: 18 }}>
              <LoadMoreControl loadingMore={loadingMore} failed={loadMoreFailed} onLoadMore={loadMore} />
            </div>
          )}
        </>
      )}
    </AccountPage>
  );
}
