import { capabilityForVendor } from "../capabilities.js";
import { db } from "../db/index.js";
import { attendeesOn } from "./options.js";
import { activeQuestions, cleanAnswers, QuestionError, questionsVersion, toPublicQuestion, writeAnswers, type CleanAnswer, type PublicQuestion } from "./questions.js";
import { ANSWER_SOURCE, type FormListingType } from "./formListings.js";

type Tx = Pick<typeof db, "prepare">;

// Phase H (docs/participation-expansion/19) — the booking side of the shared
// form for club registrations, programme enrolments and hall bookings. Same
// rules as an experience: questions show while participation.attendees is on
// and the owning organisation has both the attendees and registration_questions
// capabilities; with no published questions nothing changes in the flow.

/** Whether this organisation's listings show their registration questions. */
export async function formQuestionsOn(vendorId: string | null | undefined): Promise<boolean> {
  if (!vendorId || !(await attendeesOn())) return false;
  if (!((await capabilityForVendor(vendorId, "attendees"))?.effective ?? false)) return false;
  return (await capabilityForVendor(vendorId, "registration_questions"))?.effective ?? false;
}

export interface PublicForm {
  questions: PublicQuestion[];
  questionsVersion: number;
}

/** The live form for a listing's public page (empty when off or unpublished). */
export async function publicForm(listingType: FormListingType, listingId: string, vendorId: string | null | undefined): Promise<PublicForm> {
  if (!(await formQuestionsOn(vendorId))) return { questions: [], questionsVersion: 0 };
  return { questions: (await activeQuestions(listingType, listingId)).map(toPublicQuestion), questionsVersion: await questionsVersion(listingId, db, listingType) };
}

export interface CheckedAnswers {
  version: number;
  answers: CleanAnswer[];
}

/**
 * Validates what the booker sent against the live form, before any place is
 * held. Throws QuestionError: 409 "questions_changed" when the form changed
 * since the page loaded, 400 for a missing or invalid answer. `person` is the
 * one registrant/participant (null for a hall booking: booking questions only).
 */
export async function checkFormAnswers(
  listingType: FormListingType,
  listingId: string,
  vendorId: string | null | undefined,
  body: { answers?: unknown; questionsVersion?: unknown },
  person: { name: string; personType: "adult" | "child" } | null
): Promise<CheckedAnswers> {
  if (!(await formQuestionsOn(vendorId))) return { version: 0, answers: [] };
  const questions = await activeQuestions(listingType, listingId);
  if (!questions.length) return { version: 0, answers: [] };
  const version = await questionsVersion(listingId, db, listingType);
  // Phase M — a client that sends no form at all (an older app, or a page
  // loaded before the form was published) is told so plainly.
  if (body.questionsVersion === undefined || body.questionsVersion === null) throw new QuestionError(FORM_REQUIRED, 409, "form_required");
  if (body.questionsVersion !== version) {
    throw new QuestionError("The organiser changed the registration questions — please check your answers", 409, "questions_changed");
  }
  return { version, answers: cleanAnswers(questions, body.answers, person ? [{ attendeeNo: 1, personType: person.personType, name: person.name }] : []) };
}

export const FORM_REQUIRED = "This listing now asks registration questions — reload the page to answer them (on the app, update it first)";

/** Phase M — whether a listing's live form asks anything (so an entry point that can't show it must not book it). */
export async function hasLiveForm(listingType: FormListingType, listingId: string, vendorId: string | null | undefined): Promise<boolean> {
  if (!(await formQuestionsOn(vendorId))) return false;
  return (await activeQuestions(listingType, listingId)).some((q) => q.inputType !== "info");
}

/** Writes checked answers with the order, inside the order's own transaction. */
export async function saveFormAnswers(tx: Tx, listingType: FormListingType, ref: string, checked: CheckedAnswers | null | undefined): Promise<void> {
  if (!checked || !checked.answers.length) return;
  await writeAnswers(tx, ANSWER_SOURCE[listingType], ref, checked.version, checked.answers, "booker", true);
}

/** A programme participant is a child when a date of birth under 18 was given. */
export function personTypeFromDob(dob: string | null | undefined, today = new Date()): "adult" | "child" {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return "adult";
  const [y, m, d] = dob.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age < 18 ? "child" : "adult";
}
