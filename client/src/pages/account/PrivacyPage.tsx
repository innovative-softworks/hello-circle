import { useEffect, useState } from "react";
import { Check, MonitorSmartphone } from "lucide-react";
import { saveAccessibilityPrefs, updatePrivacyPrefs } from "../../api";
import { useToast } from "../../components/Toast";
import { LoadErrorState, RowSkeleton, Switch } from "../../components/ui";
import { ACCESSIBILITY_OPTIONS } from "../../types";
import { AccountPage, AccountSection, Chip, Note, SettingRow, SettingRows } from "./accountUi";
import { useResidentFull } from "./useResidentFull";
import { SafetySections } from "./SafetyPage";
import { useTheme, type ThemePreference } from "../../ThemeContext";

const THEMES: { key: ThemePreference; label: string }[] = [
  { key: "system", label: "Match my device" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

export function PrivacyPage() {
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const { data, loading, failed, reload } = useResidentFull();
  const [hideFamiliar, setHideFamiliar] = useState(false);
  const [discoverable, setDiscoverable] = useState(false);
  const [access, setAccess] = useState<string[]>([]);

  useEffect(() => {
    if (!data) return;
    setHideFamiliar(data.hideFromFamiliarCount);
    setDiscoverable(data.discoverableByName);
    setAccess(data.accessibilityPrefs);
  }, [data]);

  const savePrivacy = async (field: "hideFromFamiliarCount" | "discoverableByName", value: boolean, rollback: () => void) => {
    try {
      await updatePrivacyPrefs({ [field]: value });
      toast.success("Saved");
    } catch {
      rollback();
      toast.error("That setting wasn't saved. Try again.");
    }
  };

  const toggleAccess = async (opt: string) => {
    const before = access;
    const next = access.includes(opt) ? access.filter((a) => a !== opt) : [...access, opt];
    setAccess(next);
    try {
      await saveAccessibilityPrefs(next);
    } catch {
      setAccess(before);
      toast.error("That wasn't saved. Try again.");
    }
  };

  return (
    <AccountPage eyebrow="Account" title="Privacy & safety" lede="Decide who can find you, report problems, and tell us what helps you take part." narrow>
      {loading ? (
        <RowSkeleton />
      ) : failed || !data ? (
        <LoadErrorState title="We couldn't load your privacy settings." onRetry={reload} />
      ) : (
        <>
          <AccountSection title="Who can find you" description="Only your name is ever shown to other people, never your email or phone number.">
            <SettingRows>
              <SettingRow
                label="Let people find me by name"
                description="Someone inviting people to a Circle can search for you by name. Off unless you turn it on."
                control={
                  <Switch
                    checked={discoverable}
                    label="Let other residents find me by name when inviting to a Circle"
                    onChange={() => {
                      const v = !discoverable;
                      setDiscoverable(v);
                      void savePrivacy("discoverableByName", v, () => setDiscoverable(!v));
                    }}
                  />
                }
              />
              <SettingRow
                label="Hide me from familiar faces"
                description="Other people won't see you counted among those they've been to things with."
                control={
                  <Switch
                    checked={hideFamiliar}
                    label="Hide me from other people's familiar faces counts"
                    onChange={() => {
                      const v = !hideFamiliar;
                      setHideFamiliar(v);
                      void savePrivacy("hideFromFamiliarCount", v, () => setHideFamiliar(!v));
                    }}
                  />
                }
              />
            </SettingRows>
          </AccountSection>

          <SafetySections />

          <AccountSection
            title="Access needs"
            description="Saved to your profile and never shown to anyone else. Search and filters don't use them yet, so check each listing's own access details."
          >
            <div className="acct-chips" role="group" aria-label="Access needs">
              {ACCESSIBILITY_OPTIONS.map((opt) => {
                const on = access.includes(opt);
                return (
                  <Chip key={opt} pressed={on} onClick={() => toggleAccess(opt)}>
                    {on && <Check size={15} strokeWidth={2.6} aria-hidden="true" />}
                    {opt}
                  </Chip>
                );
              })}
            </div>
          </AccountSection>

          <AccountSection title="Display" description="Saved on this device.">
            <fieldset style={{ border: "none", padding: 0, margin: "0 0 18px" }}>
              <legend className="acct-row-label" style={{ marginBottom: 10 }}>Appearance</legend>
              <div className="acct-chips">
                {THEMES.map((t) => (
                  <Chip key={t.key} pressed={theme === t.key} onClick={() => setTheme(t.key)}>
                    {theme === t.key && <Check size={15} strokeWidth={2.6} aria-hidden="true" />}
                    {t.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <Note icon={<MonitorSmartphone size={16} aria-hidden="true" />}>
              Movement is kept to a minimum when your device asks for reduced motion. To make text bigger, zoom in with your browser (Ctrl or ⌘ and +).
            </Note>
          </AccountSection>

        </>
      )}
    </AccountPage>
  );
}
