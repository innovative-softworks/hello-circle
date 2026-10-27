import { useEffect, useId, useState } from "react";
import { House, UserPlus } from "lucide-react";
import { addHouseholdMember, deleteHouseholdMember, fetchHousehold, updateHouseholdMember } from "../../api";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/Toast";
import { Avatar, Button, LoadErrorState, RowSkeleton, inputStyle } from "../../components/ui";
import { irelandToday } from "../../irelandDate";
import type { HouseholdMember } from "../../types";
import { AccountEmpty, AccountPage, AccountSection, FormModal, Note, TextButton, dateLong } from "./accountUi";

// Household = people you register for (children, dependants). They are not
// accounts: no sign-in, no invitations, no permissions — the brief's
// "invite member" flow doesn't exist and isn't faked here.

type Draft = { firstName: string; lastName: string; dob: string; consent: boolean };
const EMPTY_DRAFT: Draft = { firstName: "", lastName: "", dob: "", consent: false };

function ageFrom(dob: string): number | null {
  const d = new Date(dob);
  if (!dob || Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function MemberModal({
  open,
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: Draft;
  submitLabel: string;
  onSubmit: (d: Draft) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; dob?: string }>({});
  const today = irelandToday();

  useEffect(() => {
    if (!open) return;
    setD(initial);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    const e: typeof errors = {};
    if (!d.firstName.trim()) e.firstName = "Enter a first name.";
    if (!d.lastName.trim()) e.lastName = "Enter a last name.";
    if (d.dob && d.dob > today) e.dob = "The date of birth can't be in the future.";
    setErrors(e);
    if (Object.keys(e).length) return false;
    await onSubmit({ ...d, firstName: d.firstName.trim(), lastName: d.lastName.trim() });
  };

  const field = (k: "firstName" | "lastName", label: string) => (
    <div style={{ flex: "1 1 180px" }}>
      <label htmlFor={`${id}-${k}`} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>{label}</label>
      <input
        id={`${id}-${k}`}
        value={d[k]}
        autoComplete="off"
        onChange={(e) => {
          setD({ ...d, [k]: e.target.value });
          if (errors[k]) setErrors({ ...errors, [k]: undefined });
        }}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `${id}-${k}-err` : undefined}
        autoFocus={k === "firstName"}
        style={inputStyle}
      />
      {errors[k] && <p id={`${id}-${k}-err`} className="acct-field-error">{errors[k]}</p>}
    </div>
  );

  return (
    <FormModal
      open={open}
      title={title}
      submitLabel={submitLabel}
      size="wide"
      dirty={JSON.stringify(d) !== JSON.stringify(initial)}
      error={errors.firstName || errors.lastName || errors.dob ? "Check the highlighted fields." : null}
      onClose={onClose}
      onSubmit={submit}
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {field("firstName", "First name")}
        {field("lastName", "Last name")}
      </div>
      <div style={{ maxWidth: 240 }}>
        <label htmlFor={`${id}-dob`} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>Date of birth (optional)</label>
        <input id={`${id}-dob`} type="date" max={today} value={d.dob} onChange={(e) => setD({ ...d, dob: e.target.value })} aria-invalid={!!errors.dob} aria-describedby={errors.dob ? `${id}-dob-err` : undefined} style={inputStyle} />
        {errors.dob && <p id={`${id}-dob-err`} className="acct-field-error">{errors.dob}</p>}
      </div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, lineHeight: 1.45, cursor: "pointer", minHeight: 44 }}>
        <input type="checkbox" checked={d.consent} onChange={(e) => setD({ ...d, consent: e.target.checked })} style={{ width: 20, height: 20, marginTop: 1, accentColor: "var(--color-green)", flex: "none" }} />
        I'm this person's parent or guardian, and I consent to registering them for activities.
      </label>
    </FormModal>
  );
}

export function HouseholdPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HouseholdMember | null>(null);

  // Restored (owner 2026-10-24): consent can be ticked straight from the row.
  const toggleConsent = async (m: HouseholdMember) => {
    const next = !m.guardianConsentGiven;
    setMembers((rows) => rows && rows.map((r) => (r.id === m.id ? { ...r, guardianConsentGiven: next } : r)));
    try {
      await updateHouseholdMember(m.id, { guardianConsentGiven: next });
      toast.success(next ? `Consent recorded for ${m.firstName}` : `Consent removed for ${m.firstName}`);
    } catch {
      setMembers((rows) => rows && rows.map((r) => (r.id === m.id ? { ...r, guardianConsentGiven: !next } : r)));
      toast.error("That wasn't saved. Try again.");
    }
  };

  const load = () => {
    setFailed(false);
    fetchHousehold().then(setMembers).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const remove = async (m: HouseholdMember) => {
    const ok = await confirm({
      title: `Remove ${m.firstName} from your household?`,
      message: "You'd need to add them again to register them for something new.",
      confirmLabel: `Remove ${m.firstName}`,
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteHouseholdMember(m.id);
      setMembers((rows) => rows && rows.filter((r) => r.id !== m.id));
      toast.success(`${m.firstName} removed`);
    } catch {
      toast.error(`${m.firstName} wasn't removed. Try again.`);
    }
  };

  const list = members ?? [];

  return (
    <AccountPage
      eyebrow="Household"
      title="Household"
      lede="Children and anyone else you sign up for activities. Add them once, then pick them when you register."
      actions={members && members.length > 0 ? <Button variant="ghost" onClick={() => setAdding(true)}><UserPlus size={16} aria-hidden="true" /> Add a person</Button> : undefined}
      narrow
    >
      {failed ? (
        <LoadErrorState title="We couldn't load your household." onRetry={load} />
      ) : members === null ? (
        <div style={{ marginTop: 24 }}><RowSkeleton /></div>
      ) : (
        <>
          {list.length === 0 ? (
            <AccountEmpty icon={<House size={20} aria-hidden="true" />} title="No one added yet" action={<Button onClick={() => setAdding(true)}><UserPlus size={16} aria-hidden="true" /> Add a person</Button>}>
              Registering a child for a club? Add them here first and you won't have to type their details each time.
            </AccountEmpty>
          ) : (
            <AccountSection title={`People (${list.length})`}>
              <ul className="acct-list">
                {list.map((m) => (
                  <li key={m.id} className="acct-item">
                    <Avatar name={`${m.firstName} ${m.lastName}`} size={48} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="acct-item-title">{m.firstName} {m.lastName}</div>
                      <div className="acct-item-meta">
                        {m.dob ? `${ageFrom(m.dob) !== null ? `Age ${ageFrom(m.dob)} · ` : ""}Born ${dateLong(m.dob)}` : "No date of birth"}
                      </div>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-muted)", marginTop: 6, minHeight: 32, cursor: "pointer" }}>
                        <input type="checkbox" checked={m.guardianConsentGiven} onChange={() => toggleConsent(m)} style={{ width: 18, height: 18, accentColor: "var(--color-green)" }} />
                        Guardian consent on file
                      </label>
                    </div>
                    <div className="acct-item-side">
                      <Button variant="ghost" onClick={() => setEditing(m)} aria-label={`Edit ${m.firstName}`}>Edit</Button>
                      <TextButton danger onClick={() => remove(m)} aria-label={`Remove ${m.firstName}`}>Remove</TextButton>
                    </div>
                  </li>
                ))}
              </ul>
            </AccountSection>
          )}

          <MemberModal
            open={adding}
            title="Add a person"
            submitLabel="Add to household"
            initial={EMPTY_DRAFT}
            onClose={() => setAdding(false)}
            onSubmit={async (d) => {
              await addHouseholdMember({ firstName: d.firstName, lastName: d.lastName, dob: d.dob || undefined, guardianConsentGiven: d.consent });
              toast.success(`${d.firstName} added`);
              load();
            }}
          />
          <MemberModal
            open={!!editing}
            title={editing ? `Edit ${editing.firstName}` : "Edit"}
            submitLabel="Save changes"
            initial={editing ? { firstName: editing.firstName, lastName: editing.lastName, dob: (editing.dob ?? "").slice(0, 10), consent: editing.guardianConsentGiven } : EMPTY_DRAFT}
            onClose={() => setEditing(null)}
            onSubmit={async (d) => {
              if (!editing) return;
              const id = editing.id;
              await updateHouseholdMember(id, { firstName: d.firstName, lastName: d.lastName, dob: d.dob, guardianConsentGiven: d.consent });
              setMembers((rows) => rows && rows.map((r) => (r.id === id ? { ...r, firstName: d.firstName, lastName: d.lastName, dob: d.dob, guardianConsentGiven: d.consent } : r)));
              toast.success("Changes saved");
            }}
          />

          <AccountSection>
            <Note>
              People in your household don't have their own HelloCircle accounts and can't sign in. Their details go to a club or venue only when you register
              them for something.
            </Note>
          </AccountSection>
        </>
      )}
    </AccountPage>
  );
}
