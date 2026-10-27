import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, Heart, HeartOff } from "lucide-react";
import { addFavourite, fetchFavourites, removeFavourite, updateFavouriteStatus } from "../../api";
import { ListingCard, ListingCardSkeleton } from "../../components/ListingCard";
import { SaveButton } from "../../components/SaveButton";
import { useToast } from "../../components/Toast";
import { Button, LoadErrorState, inputStyle } from "../../components/ui";
import { favouriteDetailHref } from "../../favouriteLink";
import { colors } from "../../theme";
import type { Favourite, FavouriteStatus } from "../../types";
import { useUrlParam } from "../../useUrlTab";
import { dateLabel } from "../../euro";
import { AccountEmpty, AccountPage, Chip, SearchField, SegmentedTabs, TextButton } from "./accountUi";

export const FAVOURITE_TYPE_LABEL: Record<Favourite["listingType"], string> = {
  centre: "Venue",
  club: "Club",
  game: "Activity",
  program: "Programme",
  program_session: "Programme session",
  club_session: "Club session",
  experience: "Experience",
  circle: "Circle",
};

const TYPE_GROUP: Record<Favourite["listingType"], string> = {
  game: "activities", club_session: "activities", circle: "circles", experience: "experiences", program: "programmes", program_session: "programmes", club: "places", centre: "places",
};
const TYPE_GROUPS = [
  { key: "activities", label: "Activities" },
  { key: "circles", label: "Circles" },
  { key: "experiences", label: "Experiences" },
  { key: "programmes", label: "Programmes" },
  { key: "places", label: "Clubs & venues" },
];
const STAGES: { key: FavouriteStatus; label: string }[] = [
  { key: "interested", label: "Interested" },
  { key: "planning", label: "Planning" },
  { key: "joined", label: "Joined" },
];

const key = (f: Favourite) => `${f.listingType}:${f.listingId}`;

export function SavedPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<Favourite[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Removed this visit: the card stays (heart outline) so a second tap undoes it.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [type, setType] = useUrlParam<string>("type", "all");
  const [stage, setStage] = useUrlParam<string>("stage", "all");
  const [q, setQ] = useUrlParam<string>("q", "");

  const load = () => {
    setFailed(false);
    setItems(null);
    fetchFavourites().then(setItems).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const all = items ?? [];
  const groups = TYPE_GROUPS.filter((g) => all.some((f) => TYPE_GROUP[f.listingType] === g.key));
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (f) =>
        (type === "all" || TYPE_GROUP[f.listingType] === type) &&
        (stage === "all" || f.status === stage) &&
        (!needle || `${f.name ?? ""} ${f.subtitle ?? ""} ${FAVOURITE_TYPE_LABEL[f.listingType]}`.toLowerCase().includes(needle))
    );
  }, [all, type, stage, q]);
  const filtering = type !== "all" || stage !== "all" || q.trim() !== "";

  const toggleSaved = async (f: Favourite) => {
    const k = key(f);
    const wasRemoved = removed.has(k);
    setRemoved((s) => {
      const n = new Set(s);
      if (wasRemoved) n.delete(k);
      else n.add(k);
      return n;
    });
    try {
      if (wasRemoved) {
        await addFavourite(f.listingType, f.listingId, f.status);
        toast.success("Saved again");
      } else {
        await removeFavourite(f.listingType, f.listingId);
        toast.info(`Removed ${f.name ?? "it"} from Saved. Tap the heart to undo.`);
      }
    } catch {
      setRemoved((s) => {
        const n = new Set(s);
        if (wasRemoved) n.add(k);
        else n.delete(k);
        return n;
      });
      toast.error("That didn't save. Try again.");
    }
  };

  const changeStage = async (f: Favourite, next: FavouriteStatus) => {
    const before = f.status;
    setItems((rows) => rows && rows.map((r) => (key(r) === key(f) ? { ...r, status: next } : r)));
    try {
      await updateFavouriteStatus(f.listingType, f.listingId, next);
    } catch {
      setItems((rows) => rows && rows.map((r) => (key(r) === key(f) ? { ...r, status: before } : r)));
      toast.error("That didn't save. Try again.");
    }
  };

  const liveCount = all.filter((f) => !removed.has(key(f))).length;

  return (
    <AccountPage
      eyebrow="My Life"
      title="Saved"
      lede={items && items.length > 0 ? `${liveCount} ${liveCount === 1 ? "thing" : "things"} you want to come back to.` : "Things you want to come back to."}
      actions={items && items.length > 0 ? <Button variant="ghost" onClick={() => navigate("/explore")}>Find more</Button> : undefined}
    >
      {failed ? (
        <LoadErrorState title="We couldn't load what you've saved." onRetry={load} />
      ) : items === null ? (
        <div className="acct-grid-cards" style={{ marginTop: 24 }} aria-busy="true">
          {[0, 1, 2].map((i) => <ListingCardSkeleton key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <AccountEmpty icon={<Heart size={20} aria-hidden="true" />} title="Nothing saved yet" action={<Button onClick={() => navigate("/explore")}><Compass size={16} aria-hidden="true" /> Explore what's on</Button>}>
          Tap the heart on any activity, Circle, experience, club or venue and it will wait for you here.
        </AccountEmpty>
      ) : (
        <>
          <div className="acct-toolbar">
            <SearchField value={q} onChange={setQ} label="Search saved" placeholder="Search saved" />
          </div>
          {/* Restored (owner 2026-10-24): stage filter chips. */}
          <div className="acct-chips" role="group" aria-label="Filter by stage" style={{ margin: "12px 0 14px" }}>
            {[{ key: "all", label: "All" }, ...STAGES].map((st) => (
              <Chip key={st.key} pressed={stage === st.key} onClick={() => setStage(st.key)}>{st.label}</Chip>
            ))}
          </div>
          {groups.length > 1 && (
            <SegmentedTabs
              label="Filter by type"
              value={type}
              onChange={setType}
              options={[{ key: "all", label: "All", count: all.length }, ...groups.map((g) => ({ ...g, count: all.filter((f) => TYPE_GROUP[f.listingType] === g.key).length }))]}
            />
          )}
          {shown.length === 0 ? (
            <AccountEmpty icon={<HeartOff size={20} aria-hidden="true" />} title="Nothing matches" action={filtering ? <Button variant="ghost" onClick={() => { setType("all"); setStage("all"); setQ(""); }}>Show everything</Button> : undefined}>
              Try another search or filter.
            </AccountEmpty>
          ) : (
            <div className="acct-grid-cards lc-grid--b">
              {shown.map((f) => {
                const href = favouriteDetailHref(f);
                const isRemoved = removed.has(key(f));
                const title = f.name ?? FAVOURITE_TYPE_LABEL[f.listingType];
                if (!f.name || !href) {
                  return (
                    <div key={key(f)} className="card-surface" style={{ padding: 18, borderRadius: "var(--radius-card)", border: `1px solid ${colors.border}`, background: colors.surface }}>
                      <div className="acct-eyebrow">{FAVOURITE_TYPE_LABEL[f.listingType]}</div>
                      <div className="acct-item-title">No longer available</div>
                      <p className="acct-row-desc" style={{ margin: "4px 0 12px" }}>This listing was removed or has ended.</p>
                      {isRemoved ? <span className="acct-removed">Removed from Saved</span> : <TextButton onClick={() => toggleSaved(f)}>Remove from Saved</TextButton>}
                    </div>
                  );
                }
                return (
                  <div key={key(f)} style={{ opacity: isRemoved ? 0.55 : 1 }}>
                    <ListingCard
                      href={href}
                      title={title}
                      image={f.imageUrl}
                      ph={colors.panel}
                      tag={FAVOURITE_TYPE_LABEL[f.listingType]}
                      details={[f.subtitle ? { text: f.subtitle.replace(/^(\d{4}-\d{2}-\d{2})(?:[ T·]+(\d{2}:\d{2}))?/, (_m: string, d: string, t?: string) => `${dateLabel(d)}${t ? ` · ${t}` : ""}`) } : null]}
                      save={<SaveButton saved={!isRemoved} onToggle={() => toggleSaved(f)} />}
                      facts={
                        isRemoved ? (
                          <span className="acct-removed">Removed. Tap the heart to undo.</span>
                        ) : (
                          <span className="stretched-link-above" style={{ position: "relative" }}>
                            <label className="acct-sr" htmlFor={`stage-${key(f)}`}>Stage for {title}</label>
                            <select
                              id={`stage-${key(f)}`}
                              value={f.status}
                              onChange={(e) => changeStage(f, e.target.value as FavouriteStatus)}
                              style={{ ...inputStyle, width: "auto", minHeight: 40, padding: "6px 34px 6px 12px", fontSize: 13.5, fontWeight: 600 }}
                            >
                              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </select>
                          </span>
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </AccountPage>
  );
}
