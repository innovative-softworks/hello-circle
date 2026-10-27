import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dismissMyLifeItem, fetchForYou, fetchMyLifeDismissals, fetchResidentFull, undismissMyLifeItem } from "../api";
import { trackEvent } from "../analytics";
import { useExperienceFeatures } from "../circleFeatures";
import { MadeForWeek, PreferencesModal, type Suggestion } from "../components/MyLifeEngage";
import { shortDay } from "../components/MyLifeOverview";
import { euro } from "../euro";
import { useGuest } from "../GuestContext";
import { irelandDaysFromToday, irelandToday } from "../irelandDate";
import { getMediaUrl } from "../media";
import { usePageTitle } from "../pageTitle";
import type { ForYouSection } from "../types";
import "./myLife.css";

// For Me (My Life 3.0, mylife.for_you): every section of the existing
// /discover/for-you ranking, with its reason, in the My Life style. "Not for
// me" hides an item everywhere (stored on the server, decision D4) and can
// be undone. Real listings only.

export function ForMe() {
  usePageTitle("For Me");
  const { resident, loading } = useGuest();
  const on = useExperienceFeatures()["mylife.for_you"];
  const [sections, setSections] = useState<ForYouSection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [lastHidden, setLastHidden] = useState<string | null>(null);
  // "Change what you're into" opens a popup here (owner 2026-10-26).
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<{ interests: string[]; availability: string[] }>({ interests: [], availability: [] });
  useEffect(() => {
    if (resident) fetchResidentFull().then(({ resident: r }) => r && setPrefs({ interests: r.interests, availability: r.availability })).catch(() => {});
  }, [resident]);

  const load = () => {
    setFailed(false);
    fetchForYou().then((r) => setSections(r.sections)).catch(() => setFailed(true));
    fetchMyLifeDismissals().then((r) => setDismissed(new Set(r.keys))).catch(() => {});
  };
  useEffect(() => {
    if (resident && on) load();
  }, [resident, on]);

  const hide = (key: string) => {
    setDismissed((d) => new Set([...d, key]));
    setLastHidden(key);
    trackEvent("mylife_item_dismissed", { key: "sugg" });
    dismissMyLifeItem(key).catch(() => setDismissed((d) => { const n = new Set(d); n.delete(key); return n; }));
  };
  const undo = () => {
    if (!lastHidden) return;
    const key = lastHidden;
    setLastHidden(null);
    setDismissed((d) => { const n = new Set(d); n.delete(key); return n; });
    undismissMyLifeItem(key).catch(() => {});
  };

  const day = (iso: string) => (iso === irelandToday() ? "Today" : iso === irelandDaysFromToday(1) ? "Tomorrow" : shortDay(iso));
  const toCards = (sec: ForYouSection): Suggestion[] =>
    sec.items
      .filter((it) => !dismissed.has(`sugg:${it.kind}:${it.id}`))
      .slice(0, 10)
      .map((it) => ({
        key: `${sec.key}-${it.kind}-${it.id}`,
        dismissKey: `sugg:${it.kind}:${it.id}`,
        date: it.date,
        dateLabel: day(it.date),
        time: it.time,
        title: it.title,
        meta: [it.centreName ?? it.clubName ?? it.area, it.priceCents ? euro(it.priceCents / 100) : "Free"].filter(Boolean).join(" · "),
        kind: "mine",
        kindLabel: "",
        reason: it.matchReasons?.[0] ?? sec.title,
        image: it.imageUrl ? getMediaUrl(it.imageUrl, "card") : null,
        href: it.href,
        onTrack: () => trackEvent("mylife_suggestion_opened", { section: sec.key }),
      }));

  const visible = (sections ?? []).map((s) => ({ s, cards: toCards(s) })).filter((x) => x.cards.length > 0);

  return (
    <div className="mlx">
      <header className="mlx-head">
        <div style={{ minWidth: 0 }}>
          <p className="mlx-label"><Link to="/bookings" className="mlx-crumb">My Life</Link> · For Me</p>
          <h1 className="mlx-title">Made for you.</h1>
          <p className="mlx-summary">Real things on soon, chosen from your interests, free times, area and Circles. Each one says why it's here.</p>
        </div>
        <div className="mlx-head-actions">
          {resident && <button type="button" className="mlx-link" onClick={() => setPrefsOpen(true)}>Change what you're into</button>}
        </div>
      </header>
      <PreferencesModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        interests={prefs.interests}
        availability={prefs.availability}
        onSaved={() => {
          fetchResidentFull().then(({ resident: r }) => r && setPrefs({ interests: r.interests, availability: r.availability })).catch(() => {});
          load();
        }}
      />
      <div className="mlx-body" style={{ paddingBottom: 80 }}>
        {lastHidden && (
          <div className="mlx-note" role="status">
            <p><strong>Hidden. We won't suggest it again.</strong></p>
            <button type="button" className="mlx-link" onClick={undo}>Undo</button>
          </div>
        )}
        {loading ? null : !resident ? (
          <div className="mlx-nothing">
            <h2 className="mlx-nothing-title">Sign in for ideas made for you.</h2>
            <div><Link className="mlx-btn" to="/signin">Sign in</Link></div>
          </div>
        ) : !on ? (
          <p className="mlx-muted">For Me isn't switched on yet.</p>
        ) : failed ? (
          <p className="mlx-muted">Your suggestions didn't load. <button type="button" className="mlx-link" onClick={load}>Try again</button></p>
        ) : !sections ? (
          <p className="mlx-muted">Finding things for you…</p>
        ) : visible.length === 0 ? (
          <div className="mlx-nothing">
            <h2 className="mlx-nothing-title">Nothing to suggest yet.</h2>
            <p className="mlx-muted">Tell us what you're into and when you're free, and this fills up with real things nearby.</p>
            <div><button type="button" className="mlx-btn" onClick={() => setPrefsOpen(true)}>Set your interests</button></div>
          </div>
        ) : (
          visible.map(({ s, cards }) => <MadeForWeek key={s.key} title={s.title} items={cards} onDismiss={hide} />)
        )}
      </div>
    </div>
  );
}
