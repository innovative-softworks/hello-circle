import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchFreeTimeOptions } from "../../api";
import { irelandToday } from "../../irelandDate";
import type { DiscoverItem } from "../../types";
import { DiscoverCard } from "../DiscoverRow";
import { LightbulbIcon } from "../icons";
import { Button, EmptyState, Modal, Skeleton } from "../ui";
import "../circle/circleExperience.css";

// Experience 3.0 — "Find something for me" (experience.smart_match) and
// "Going solo" (experience.go_solo), as refine controls on Free Time Mode's
// results, plus "Surprise me". Every filter maps to a fact the listing states;
// the cards explain each suggestion with the server's own reasons. Nothing is
// booked here — each card goes to the listing's normal page.

export interface SmartFilters {
  when: "" | "today" | "tomorrow" | "weekend";
  partOfDay: string[];
  maxPriceCents: number | null;
  solo: boolean;
}

export const NO_FILTERS: SmartFilters = { when: "", partOfDay: [], maxPriceCents: null, solo: false };

const WHEN: { value: SmartFilters["when"]; label: string }[] = [
  { value: "", label: "Any day" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
];
const PARTS = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];
const BUDGETS: { value: number | null; label: string }[] = [
  { value: null, label: "Any budget" },
  { value: 0, label: "Free" },
  { value: 1000, label: "Up to €10" },
  { value: 2000, label: "Up to €20" },
  { value: 5000, label: "Up to €50" },
];

export function SmartMatchRefine({ value, onChange, goSolo }: { value: SmartFilters; onChange: (next: SmartFilters) => void; goSolo: boolean }) {
  const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div role="group" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--color-muted-light)", minWidth: 64 }}>{label}</span>
      {children}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "0 0 28px", paddingBottom: 20, borderBottom: "1px solid var(--color-border)" }}>
      <Group label="When">
        {WHEN.map((w) => (
          <button key={w.label} type="button" className="ce-chip" aria-pressed={value.when === w.value} onClick={() => onChange({ ...value, when: w.value })}>
            {w.label}
          </button>
        ))}
      </Group>
      <Group label="Time">
        {PARTS.map((p) => (
          <button
            key={p.value}
            type="button"
            className="ce-chip"
            aria-pressed={value.partOfDay.includes(p.value)}
            onClick={() => onChange({ ...value, partOfDay: value.partOfDay.includes(p.value) ? value.partOfDay.filter((x) => x !== p.value) : [...value.partOfDay, p.value] })}
          >
            {p.label}
          </button>
        ))}
      </Group>
      <Group label="Budget">
        {BUDGETS.map((b) => (
          <button key={b.label} type="button" className="ce-chip" aria-pressed={value.maxPriceCents === b.value} onClick={() => onChange({ ...value, maxPriceCents: b.value })}>
            {b.label}
          </button>
        ))}
      </Group>
      {goSolo && (
        <Group label="Who">
          <button type="button" className="ce-chip" aria-pressed={!value.solo} onClick={() => onChange({ ...value, solo: false })}>
            With others or alone
          </button>
          <button type="button" className="ce-chip" aria-pressed={value.solo} onClick={() => onChange({ ...value, solo: true })}>
            I'm going solo
          </button>
        </Group>
      )}
      {value.solo && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted-light)" }}>
          Only listings whose host said people come on their own, first-timers are welcome, or they introduce everyone. Nobody else is told you're coming alone.
        </p>
      )}
    </div>
  );
}

export function smartParams(f: SmartFilters) {
  return { when: f.when || undefined, partOfDay: f.partOfDay, maxPriceCents: f.maxPriceCents ?? undefined, solo: f.solo };
}

/** What to try when nothing matches — never invented results. */
export function NoMatchHelp({ onBroaden, filtered }: { onBroaden: () => void; filtered: boolean }) {
  return (
    <EmptyState
      icon={<LightbulbIcon size={22} />}
      title="Nothing matches that yet"
      subtitle="Nothing on HelloCircle fits all of that right now. You could widen it, try another day, or find a Circle that does this regularly."
      action={
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {filtered && <Button onClick={onBroaden}>Clear the filters</Button>}
          <Link to="/circles" className="ce-link">
            Find a Circle
          </Link>
          <Link to="/profile?tab=preferences" className="ce-link">
            Save what you like for suggestions later
          </Link>
        </div>
      }
    />
  );
}

/** One real suggestion at a time; "Show another" never repeats one shown in this session. */
export function SurpriseMe({ base, onClose }: { base: Parameters<typeof fetchFreeTimeOptions>[0]; onClose: () => void }) {
  const [item, setItem] = useState<DiscoverItem | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<string[]>([]);
  const next = async () => {
    setItem(undefined);
    setError(null);
    try {
      const [pick] = await fetchFreeTimeOptions({ ...base, surprise: true, exclude: seen.current });
      if (pick) seen.current = [...seen.current, pick.id];
      setItem(pick ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't find a suggestion. Try again.");
      setItem(null);
    }
  };
  useEffect(() => {
    void next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal
      open
      onClose={onClose}
      title="Surprise me"
      subtitle="A real thing you could do, picked from what fits."
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
          <Button onClick={next} disabled={item === undefined || (item === null && seen.current.length > 0 && !error)}>
            Show another
          </Button>
        </div>
      }
    >
      {item === undefined ? (
        <Skeleton height={260} />
      ) : error ? (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 14 }}>
          {error}
        </p>
      ) : item === null ? (
        <p style={{ fontSize: 14.5, margin: 0 }}>{seen.current.length ? "That's everything that fits right now — you've seen them all." : "Nothing fits those choices right now."}</p>
      ) : (
        <div style={{ maxWidth: 360, margin: "0 auto" }}>
          <DiscoverCard item={item} isToday={item.date === irelandToday()} fill />
        </div>
      )}
    </Modal>
  );
}
