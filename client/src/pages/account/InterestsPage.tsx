import { useEffect, useMemo, useState } from "react";
import {
  Baby,
  Check,
  Dumbbell,
  Feather,
  Footprints,
  GraduationCap,
  HeartPulse,
  Palette,
  PartyPopper,
  PersonStanding,
  Sparkles,
  Trees,
  Trophy,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { clearPreferences, saveOnboarding } from "../../api";
import { useToast } from "../../components/Toast";
import { ConfirmDialog, LoadErrorState, RowSkeleton, Switch } from "../../components/ui";
import {
  AVAILABILITY_PRESETS,
  DAY_LABELS,
  DAYS,
  GOALS,
  MAX_GOALS,
  presetSelected,
  SLOT_LABELS,
  SLOTS,
  token,
  togglePreset,
  toggleGoal,
  toggleToken,
} from "../../participationVocab";
import { BUDGET_OPTIONS, GROUP_SIZE_OPTIONS, INTEREST_OPTIONS, type ResidentFull } from "../../types";
import { AccountPage, AccountSection, Chip, Note, SaveBar, SettingRow, SettingRows, TextButton } from "./accountUi";
import { useMediaQuery } from "./useMediaQuery";
import { useResidentFull } from "./useResidentFull";

const INTEREST_ICON: Record<string, LucideIcon> = {
  Badminton: Feather,
  Football: Trophy,
  Swimming: Waves,
  Fitness: Dumbbell,
  Yoga: PersonStanding,
  Walking: Footprints,
  "Kids activities": Baby,
  Arts: Palette,
  Learning: GraduationCap,
  "Community events": PartyPopper,
  Outdoor: Trees,
  Wellbeing: HeartPulse,
};

const RADIUS_KM = [2, 5, 10, 20];
const AREA_TENURE = [
  { v: "new", l: "Yes, I'm new here" },
  { v: "settled", l: "I've been here a while" },
  { v: "exploring", l: "Just exploring" },
];

type Prefs = {
  interests: string[];
  goals: string[];
  availability: string[];
  searchRadiusKm: number;
  prefGroupSize: string;
  prefBudget: string;
  prefBeginnerFriendly: boolean;
  prefSoloFriendly: boolean;
  prefFirstTimer: boolean;
  prefFamily: boolean;
  areaTenure: string;
};

const EMPTY: Prefs = {
  interests: [], goals: [], availability: [], searchRadiusKm: 5, prefGroupSize: "", prefBudget: "",
  prefBeginnerFriendly: false, prefSoloFriendly: false, prefFirstTimer: false, prefFamily: false, areaTenure: "",
};

function fromResident(r: ResidentFull): Prefs {
  return {
    interests: r.interests,
    goals: r.goals,
    availability: r.availability,
    searchRadiusKm: r.searchRadiusKm || 5,
    prefGroupSize: r.prefGroupSize,
    prefBudget: r.prefBudget,
    prefBeginnerFriendly: r.prefBeginnerFriendly,
    prefSoloFriendly: r.prefSoloFriendly,
    prefFirstTimer: r.prefFirstTimer ?? false,
    prefFamily: r.prefFamily ?? false,
    areaTenure: r.areaTenure ?? "",
  };
}

const same = (a: Prefs, b: Prefs) =>
  JSON.stringify({ ...a, interests: [...a.interests].sort(), goals: [...a.goals].sort(), availability: [...a.availability].sort() }) ===
  JSON.stringify({ ...b, interests: [...b.interests].sort(), goals: [...b.goals].sort(), availability: [...b.availability].sort() });

const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Days × morning/afternoon/evening. Every cell is a toggle button with a
 * full spoken name ("Saturday morning, free"), so it works by keyboard and
 * screen reader without the grid. Phones flip it: days down, periods across. */
function WeekGrid({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const phone = useMediaQuery("(max-width: 640px)");
  const cell = (d: (typeof DAYS)[number], s: (typeof SLOTS)[number]) => {
    const t = token(d, s);
    const on = value.includes(t);
    return (
      <button
        key={t}
        type="button"
        className="acct-week-cell"
        aria-pressed={on}
        aria-label={`${DAY_LABELS[d]} ${SLOT_LABELS[s].toLowerCase()}`}
        onClick={() => onChange(toggleToken(value, t))}
      >
        <Check size={16} strokeWidth={2.6} aria-hidden="true" />
      </button>
    );
  };
  if (phone) {
    return (
      <div className="acct-week acct-week--phone" role="group" aria-label="Days and times you're usually free">
        <span />
        {SLOTS.map((s) => <span key={s} className="acct-week-h">{SLOT_LABELS[s]}</span>)}
        {DAYS.map((d) => [<span key={d} className="acct-week-h acct-week-h--row">{DAY_LABELS[d]}</span>, ...SLOTS.map((s) => cell(d, s))])}
      </div>
    );
  }
  return (
    <div className="acct-week" role="group" aria-label="Days and times you're usually free">
      <span />
      {DAYS.map((d) => <span key={d} className="acct-week-h">{DAY_LABELS[d]}</span>)}
      {SLOTS.map((s) => [<span key={s} className="acct-week-h acct-week-h--row">{SLOT_LABELS[s]}</span>, ...DAYS.map((d) => cell(d, s))])}
    </div>
  );
}

export function InterestsPage() {
  const toast = useToast();
  const { data, loading, failed, reload } = useResidentFull();
  const [saved, setSaved] = useState<Prefs>(EMPTY);
  const [draft, setDraft] = useState<Prefs>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!data) return;
    const p = fromResident(data);
    setSaved(p);
    setDraft(p);
  }, [data]);

  const dirty = useMemo(() => !same(saved, draft), [saved, draft]);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await saveOnboarding(draft);
      setSaved(draft);
      toast.success("Preferences saved");
    } catch {
      toast.error("Your preferences weren't saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await clearPreferences();
      const cleared = { ...EMPTY, searchRadiusKm: draft.searchRadiusKm };
      setSaved(cleared);
      setDraft(cleared);
      setConfirmClear(false);
      toast.success("Preferences cleared");
    } catch {
      toast.error("Your preferences weren't cleared. Try again.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <AccountPage
      eyebrow="Account"
      title="Interests & discovery"
      lede="Tell us what you like and when you're free. Explore uses this to rank what it suggests and to say why something fits."
      narrow
    >
      {loading ? (
        <RowSkeleton />
      ) : failed || !data ? (
        <LoadErrorState title="We couldn't load your preferences." onRetry={reload} />
      ) : (
        <>
          <AccountSection title="Your interests" description={draft.interests.length ? `${draft.interests.length} chosen` : "Pick as many as you like."}>
            <div className="acct-tiles" role="group" aria-label="Interests">
              {INTEREST_OPTIONS.map((opt) => {
                const Icon = INTEREST_ICON[opt] ?? Sparkles;
                const on = draft.interests.includes(opt);
                return (
                  <button key={opt} type="button" className="acct-tile" aria-pressed={on} onClick={() => set("interests", toggleIn(draft.interests, opt))}>
                    <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
                    {opt}
                    <span className="acct-tile-check" aria-hidden="true">{on && <Check size={13} strokeWidth={3} />}</span>
                  </button>
                );
              })}
            </div>
          </AccountSection>

          <AccountSection title="What brings you here?" description={`Pick up to ${MAX_GOALS}.${draft.goals.length >= MAX_GOALS ? " Unselect one to choose another." : ""}`}>
            <div className="acct-chips" role="group" aria-label="Goals">
              {GOALS.map((g) => {
                const on = draft.goals.includes(g);
                return (
                  <Chip key={g} pressed={on} disabled={!on && draft.goals.length >= MAX_GOALS} onClick={() => set("goals", toggleGoal(draft.goals, g))}>
                    {on && <Check size={15} strokeWidth={2.6} aria-hidden="true" />}
                    {g}
                  </Chip>
                );
              })}
            </div>
          </AccountSection>

          <AccountSection title="When you're usually free" description="Tap a quick pick, or customise it day by day.">
            <div className="acct-chips" role="group" aria-label="Quick picks" style={{ marginBottom: 18 }}>
              {AVAILABILITY_PRESETS.map((p) => (
                <Chip key={p.label} pressed={presetSelected(draft.availability, p)} onClick={() => set("availability", togglePreset(draft.availability, p))}>
                  {p.label}
                </Chip>
              ))}
            </div>
            {/* Restored (owner 2026-10-24): the day-by-day grid sits behind "Customise day by day". */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: customising ? 14 : 0 }}>
              <TextButton onClick={() => setCustomising((c) => !c)} aria-expanded={customising} aria-controls="acct-week-grid">
                {customising ? "Hide day-by-day" : "Customise day by day"}
              </TextButton>
              {draft.availability.length > 0 && <TextButton onClick={() => set("availability", [])}>Clear the week</TextButton>}
            </div>
            {customising && (
              <div id="acct-week-grid">
                <WeekGrid value={draft.availability} onChange={(v) => set("availability", v)} />
              </div>
            )}
          </AccountSection>

          <AccountSection title="How you like to take part">
            <div style={{ display: "grid", gap: 22 }}>
              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend className="acct-row-label" style={{ marginBottom: 10 }}>Show me things within</legend>
                <div className="acct-chips">
                  {RADIUS_KM.map((km) => (
                    <Chip key={km} pressed={draft.searchRadiusKm === km} onClick={() => set("searchRadiusKm", km)}>{km} km</Chip>
                  ))}
                </div>
              </fieldset>
              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend className="acct-row-label" style={{ marginBottom: 10 }}>Group size</legend>
                <div className="acct-chips">
                  {GROUP_SIZE_OPTIONS.map((o) => (
                    <Chip key={o.key} pressed={draft.prefGroupSize === o.key} onClick={() => set("prefGroupSize", draft.prefGroupSize === o.key ? "" : o.key)}>{o.label}</Chip>
                  ))}
                </div>
              </fieldset>
              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend className="acct-row-label" style={{ marginBottom: 10 }}>Budget</legend>
                <div className="acct-chips">
                  {BUDGET_OPTIONS.map((o) => (
                    <Chip key={o.key} pressed={draft.prefBudget === o.key} onClick={() => set("prefBudget", draft.prefBudget === o.key ? "" : o.key)}>{o.label}</Chip>
                  ))}
                </div>
              </fieldset>
            </div>
            <div style={{ marginTop: 22 }}>
              <SettingRows>
                <SettingRow label="Beginner-friendly" description="Favour activities that welcome people trying something for the first time." control={<Switch checked={draft.prefBeginnerFriendly} onChange={() => set("prefBeginnerFriendly", !draft.prefBeginnerFriendly)} label="Beginner-friendly" />} />
                <SettingRow label="Happy to come alone" description="Favour activities where people often come on their own." control={<Switch checked={draft.prefSoloFriendly} onChange={() => set("prefSoloFriendly", !draft.prefSoloFriendly)} label="Happy to come alone" />} />
                <SettingRow label="First-timer friendly" description="Favour hosts who say first-timers are welcome." control={<Switch checked={draft.prefFirstTimer} onChange={() => set("prefFirstTimer", !draft.prefFirstTimer)} label="First-timer friendly" />} />
                <SettingRow label="Family friendly" description="Favour activities that suit children with a parent or guardian." control={<Switch checked={draft.prefFamily} onChange={() => set("prefFamily", !draft.prefFamily)} label="Family friendly" />} />
              </SettingRows>
            </div>
          </AccountSection>

          <AccountSection title="Are you new to the area?" description="Optional. If you're new, we'll show a few easy ways to get started.">
            <div className="acct-chips" role="group" aria-label="New to the area">
              {AREA_TENURE.map((o) => (
                <Chip key={o.v} pressed={draft.areaTenure === o.v} onClick={() => set("areaTenure", draft.areaTenure === o.v ? "" : o.v)}>{o.l}</Chip>
              ))}
            </div>
          </AccountSection>

          <AccountSection title="How this is used">
            <Note>
              Explore ranks suggestions using these choices and shows the reason, for example “You're normally free Saturday mornings”. You can
              clear them at any time.
            </Note>
            <div style={{ marginTop: 14 }}>
              <TextButton danger onClick={() => setConfirmClear(true)}>Clear all my preferences</TextButton>
            </div>
          </AccountSection>

          <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(saved)} saveLabel="Save preferences" />
        </>
      )}
      <ConfirmDialog
        open={confirmClear}
        title="Clear your preferences?"
        message="Your interests, availability, goals, comfort preferences and saved access needs will be removed. Your account, bookings, privacy and notification settings aren't affected."
        confirmLabel={clearing ? "Clearing…" : "Clear preferences"}
        cancelLabel="Keep them"
        busy={clearing}
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </AccountPage>
  );
}
