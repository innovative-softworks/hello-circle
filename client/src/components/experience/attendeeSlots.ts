import type { AnswerValue, AttendeeInput, RegistrationOption, RegistrationQuestion } from "../../types";
import type { OptionQuantities } from "./OptionPicker";

// Participation Phase 2 — the people a booking needs details for, in the same
// order the server reads them (server/src/participation/attendees.ts
// slotsForResolved): each chosen option that includes people, in display
// order, one slot per head; add-ons carry nobody. Without options it's one
// slot per person in the party. Display/validation help only — the server
// re-derives the slots and refuses a mismatch.

export interface PersonSlot {
  lineLabel: string | null;
  /** Fixed by the option's age band; null = the booker says. */
  fixedType: "adult" | "child" | null;
}

const typeForBand = (band: string | null | undefined): "adult" | "child" | null =>
  band === "child" || band === "infant" ? "child" : band === "adult" || band === "senior" ? "adult" : null;

export function personSlots(options: RegistrationOption[] | null, qty: OptionQuantities, partySize: number): PersonSlot[] {
  if (!options) return Array.from({ length: partySize }, () => ({ lineLabel: null, fixedType: null }));
  const out: PersonSlot[] = [];
  for (const o of options) {
    if (o.kind === "addon") continue;
    const heads = (qty[o.id] ?? 0) * o.headsPerUnit;
    for (let i = 0; i < heads; i++) out.push({ lineLabel: o.label, fixedType: typeForBand(o.ageBand) });
  }
  return out;
}

export interface PersonDraft {
  name: string;
  personType: "adult" | "child";
  /** "contact" or the 1-based number of an adult in this booking; "" = not chosen. */
  guardian: "contact" | number | "";
}

/** Keeps what was typed when the slots change (more or fewer people). */
export function fitPeople(prev: PersonDraft[], slots: PersonSlot[], contactName: string): PersonDraft[] {
  return slots.map((s, i) => {
    const p = prev[i];
    const personType = s.fixedType ?? p?.personType ?? "adult";
    const name = p?.name ?? (i === 0 && personType === "adult" ? contactName : "");
    const guardian = personType === "child" ? (p?.guardian ?? "") : "";
    return { name, personType, guardian };
  });
}

export function toAttendeeInput(people: PersonDraft[]): AttendeeInput[] {
  return people.map((p) => ({ name: p.name.trim(), personType: p.personType, ...(p.personType === "child" && p.guardian !== "" ? { guardian: p.guardian } : {}) }));
}

export const appliesTo = (q: RegistrationQuestion, t: "adult" | "child") => q.appliesTo === "all" || q.appliesTo === t;

/** Missing required answers, as { fieldId, message } for the form's error summary. */
export function missingAnswers(
  questions: RegistrationQuestion[],
  people: PersonDraft[],
  answers: { booking: Record<string, AnswerValue>; attendees: Record<string, AnswerValue>[] }
): { fieldId: string; message: string }[] {
  const empty = (v: AnswerValue | undefined) => v === undefined || v === "" || v === false;
  const out: { fieldId: string; message: string }[] = [];
  for (const q of questions) {
    if (!q.required) continue;
    if (q.scope === "booking") {
      if (empty(answers.booking[q.key])) out.push({ fieldId: questionFieldId(q.key, 0), message: `Answer "${q.label}"` });
      continue;
    }
    people.forEach((p, i) => {
      if (appliesTo(q, p.personType) && empty(answers.attendees[i]?.[q.key])) out.push({ fieldId: questionFieldId(q.key, i + 1), message: `${p.name || `Person ${i + 1}`}: answer "${q.label}"` });
    });
  }
  return out;
}

export const questionFieldId = (key: string, personNo: number) => `rq-${key}-${personNo}`;

/** The option a person came with, unless it only repeats "Adult"/"Child". */
export function optionNote(lineLabel: string | null, personType: "adult" | "child"): string | null {
  if (!lineLabel) return null;
  const l = lineLabel.trim().toLowerCase();
  return l === personType || l === `${personType}s` || (personType === "child" && l === "children") ? null : lineLabel;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Age:" but "How will you travel?" — no colon after a question mark. */
export const answerLabel = (label: string) => (/[?:]$/.test(label.trim()) ? `${label.trim()} ` : `${label.trim()}: `);
