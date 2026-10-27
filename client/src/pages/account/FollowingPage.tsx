import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Store, UserRound, UserRoundCheck, UserRoundX } from "lucide-react";
import { fetchMyFollows, followEntity, setFollowNotificationLevel, unfollowEntity, type FollowedEntity, type FollowedType, type NotificationLevel } from "../../api";
import { Photo } from "../../components/Photo";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/Toast";
import { Button, LoadErrorState, RowSkeleton, inputStyle } from "../../components/ui";
import { colors } from "../../theme";
import { useUrlParam } from "../../useUrlTab";
import { AccountEmpty, AccountPage, SearchField, SegmentedTabs, TextButton } from "./accountUi";

const TYPE_LABEL: Record<FollowedType, string> = { host: "Host", vendor: "Provider", centre: "Venue" };
const TYPE_TABS: { key: FollowedType; label: string }[] = [
  { key: "host", label: "Hosts" },
  { key: "vendor", label: "Providers" },
  { key: "centre", label: "Venues" },
];
const TYPE_ICON = { host: UserRound, vendor: Store, centre: Building2 } as const;

const key = (f: FollowedEntity) => `${f.followedType}:${f.followedId}`;

export function FollowingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [follows, setFollows] = useState<FollowedEntity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [unfollowed, setUnfollowed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [type, setType] = useUrlParam<string>("ftype", "all");
  const [q, setQ] = useUrlParam<string>("fq", "");

  const load = () => {
    setFailed(false);
    setFollows(null);
    fetchMyFollows().then(setFollows).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const all = follows ?? [];
  const tabs = TYPE_TABS.filter((t) => all.some((f) => f.followedType === t.key));
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((f) => (type === "all" || f.followedType === type) && (!needle || (f.name ?? "").toLowerCase().includes(needle)));
  }, [all, type, q]);

  const setLevel = async (f: FollowedEntity, level: NotificationLevel) => {
    const before = f.notificationLevel;
    setFollows((rows) => rows && rows.map((r) => (key(r) === key(f) ? { ...r, notificationLevel: level } : r)));
    try {
      await setFollowNotificationLevel(f.followedType, f.followedId, level);
      toast.success(level === "everything" ? `You'll hear about everything from ${f.name ?? "them"}` : `You'll hear highlights from ${f.name ?? "them"}`);
    } catch {
      setFollows((rows) => rows && rows.map((r) => (key(r) === key(f) ? { ...r, notificationLevel: before } : r)));
      toast.error("That didn't save. Try again.");
    }
  };

  const unfollow = async (f: FollowedEntity) => {
    const ok = await confirm({
      title: `Unfollow ${f.name ?? "this account"}?`,
      message: "You'll stop getting updates when they post something new. You can follow again any time.",
      confirmLabel: "Unfollow",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(key(f));
    try {
      await unfollowEntity(f.followedType, f.followedId);
      setUnfollowed((s) => new Set(s).add(key(f)));
    } catch {
      toast.error("You're still following them. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const undo = async (f: FollowedEntity) => {
    setBusy(key(f));
    try {
      await followEntity(f.followedType, f.followedId);
      // A new follow starts at the default level; put back what they had.
      if (f.notificationLevel !== "highlights") await setFollowNotificationLevel(f.followedType, f.followedId, f.notificationLevel);
      setUnfollowed((s) => {
        const n = new Set(s);
        n.delete(key(f));
        return n;
      });
      toast.success(`Following ${f.name ?? "them"} again`);
    } catch {
      toast.error("That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const count = all.filter((f) => !unfollowed.has(key(f))).length;

  return (
    <AccountPage eyebrow="My Life" title="Following" lede={follows && follows.length > 0 ? `You follow ${count} ${count === 1 ? "host, provider or venue" : "hosts, providers and venues"}. You'll hear when they start something new.` : "Hosts, providers and venues you want to hear from."}>
      {failed ? (
        <LoadErrorState title="We couldn't load who you follow." onRetry={load} />
      ) : follows === null ? (
        <div style={{ marginTop: 24 }}><RowSkeleton /></div>
      ) : follows.length === 0 ? (
        <AccountEmpty icon={<UserRoundCheck size={20} aria-hidden="true" />} title="You're not following anyone yet" action={<Button onClick={() => navigate("/explore")}>Explore what's on</Button>}>
          Tap Follow on a host's, provider's or venue's page to hear when they put on something new.
        </AccountEmpty>
      ) : (
        <>
          {all.length > 5 && (
            <div className="acct-toolbar">
              <SearchField value={q} onChange={setQ} label="Search who you follow" placeholder="Search by name" />
            </div>
          )}
          {tabs.length > 1 && (
            <SegmentedTabs
              label="Filter by type"
              value={type}
              onChange={setType}
              options={[{ key: "all", label: "All", count: all.length }, ...tabs.map((t) => ({ ...t, count: all.filter((f) => f.followedType === t.key).length }))]}
            />
          )}
          {shown.length === 0 ? (
            <AccountEmpty icon={<UserRoundX size={20} aria-hidden="true" />} title="No one matches" action={<Button variant="ghost" onClick={() => { setType("all"); setQ(""); }}>Show everyone</Button>} />
          ) : (
            <ul className="acct-list" style={{ marginTop: tabs.length > 1 ? 0 : 20 }}>
              {shown.map((f) => {
                const Icon = TYPE_ICON[f.followedType];
                const gone = unfollowed.has(key(f));
                const name = f.name ?? "Removed account";
                return (
                  <li key={key(f)} className="acct-item" data-muted={gone ? "true" : undefined}>
                    <Link to={f.href} className="acct-item-main">
                      <span className={`acct-thumb${f.followedType === "host" ? " acct-thumb--round" : ""}`}>
                        <Photo
                          src={f.imageUrl ?? undefined}
                          alt=""
                          ph={colors.panel}
                          variant="thumbnail"
                          style={{ width: "100%", height: "100%" }}
                          icon={!f.imageUrl ? <Icon size={18} aria-hidden="true" /> : undefined}
                        />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="acct-item-title" style={{ display: "block" }}>{name}</span>
                        <span className="acct-item-meta" style={{ display: "block" }}>{TYPE_LABEL[f.followedType]}</span>
                      </span>
                    </Link>
                    <div className="acct-item-side">
                      {gone ? (
                        <>
                          <span className="acct-removed" role="status">Unfollowed</span>
                          <TextButton onClick={() => undo(f)} disabled={busy === key(f)}>Undo</TextButton>
                        </>
                      ) : (
                        <>
                          <label className="acct-sr" htmlFor={`lvl-${key(f)}`}>Updates from {name}</label>
                          <select
                            id={`lvl-${key(f)}`}
                            value={f.notificationLevel}
                            onChange={(e) => setLevel(f, e.target.value as NotificationLevel)}
                            style={{ ...inputStyle, width: "auto", minHeight: 44, fontSize: 13.5, paddingRight: 34 }}
                          >
                            <option value="highlights">Highlights only</option>
                            <option value="everything">Everything</option>
                          </select>
                          <Button variant="ghost" onClick={() => unfollow(f)} disabled={busy === key(f)} aria-label={`Unfollow ${name}`}>
                            Unfollow
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </AccountPage>
  );
}
