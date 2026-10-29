import { db } from "../db/index.js";
import { featureOn } from "../circleFeatures.js";
import { activeQuestions, cleanAnswers, cleanQuestionSet, QuestionError, questionsVersion, readAnswersFor, replaceQuestions, toPublicQuestion, writeAnswers, type CleanAnswer, type StoredAnswer } from "./questions.js";
import { FORM_REQUIRED } from "./formAnswers.js";

type Tx = Pick<typeof db, "prepare">;

// Phase N (docs/participation-expansion/24) — participation questions on an
// activity a resident hosts. Hosts choose from a fixed, approved library
// (skill level, position, equipment, team, arrival) and whether each is
// required; they can't write their own wording, so nothing sensitive can be
// asked, and there is no access to the partner form builder. Same question,
// answer and version tables as every other form (listing_type 'game';
// answers keyed "<gameId>:<residentId>"), the same version check at join,
// and answers are visible to the host only. Behind participation.host_questions.

export const MAX_HOST_QUESTIONS = 3;

export const HOST_LIBRARY = [
  { key: "q_hostlevel", label: "Your level", purpose: "So the host can balance the game", inputType: "radio", choices: ["Beginner", "Intermediate", "Advanced"] },
  { key: "q_hostposition", label: "Preferred position", purpose: "So the host can plan the teams", inputType: "text", maxLength: 60 },
  { key: "q_hostequip", label: "Equipment", purpose: "So there's enough kit", inputType: "radio", choices: ["I'll bring my own", "I'd like to borrow some", "None needed"] },
  { key: "q_hostteam", label: "Preferred team or group", purpose: "So friends can play together", inputType: "text", maxLength: 40 },
  { key: "q_hostarrive", label: "I'll arrive on time for the start", purpose: "So the host knows who to wait for", inputType: "checkbox" },
] as const;
export type HostQuestionKey = (typeof HOST_LIBRARY)[number]["key"];

export const hostQuestionsOn = () => featureOn("participation.host_questions");

const refOf = (gameId: string, residentId: string) => `${gameId}:${residentId}`;

/** The host chooses which library questions to ask (and which are required). */
export async function setGameQuestions(gameId: string, hostId: string, picks: unknown): Promise<{ version: number }> {
  if (!Array.isArray(picks)) throw new QuestionError("Choose the questions to ask");
  if (picks.length > MAX_HOST_QUESTIONS) throw new QuestionError(`Ask at most ${MAX_HOST_QUESTIONS} questions`);
  const seen = new Set<string>();
  const rows = picks.map((p) => {
    const pick = (p ?? {}) as { key?: unknown; required?: unknown };
    const lib = HOST_LIBRARY.find((l) => l.key === pick.key);
    if (!lib) throw new QuestionError("That question isn't one hosts can ask");
    if (seen.has(lib.key)) throw new QuestionError(`"${lib.label}" is already chosen`);
    seen.add(lib.key);
    return {
      key: lib.key,
      scope: "attendee",
      inputType: lib.inputType,
      label: lib.label,
      purpose: lib.purpose,
      help: "",
      choices: "choices" in lib ? [...lib.choices] : [],
      maxLength: "maxLength" in lib ? lib.maxLength : null,
      required: pick.required === true,
      category: "general",
      editability: "until_start",
    };
  });
  // The same validation as every form (types, wording checks, sensitive data refused).
  const set = cleanQuestionSet(rows, false, undefined, "game");
  const saved = await replaceQuestions(gameId, set, await questionsVersion(gameId, db, "game"), hostId, "game");
  return { version: saved.version };
}

/** What a joiner is asked (empty when off or none chosen). */
export async function publicGameQuestions(gameId: string) {
  if (!(await hostQuestionsOn())) return { questions: [], questionsVersion: 0 };
  return { questions: (await activeQuestions("game", gameId)).map(toPublicQuestion), questionsVersion: await questionsVersion(gameId, db, "game") };
}

export interface CheckedGameAnswers { version: number; answers: CleanAnswer[] }

/** Validates a joiner's answers before the join (409 when the questions changed or weren't sent). */
export async function checkGameAnswers(gameId: string, body: { answers?: unknown; questionsVersion?: unknown }, name: string): Promise<CheckedGameAnswers | null> {
  if (!(await hostQuestionsOn())) return null;
  const questions = await activeQuestions("game", gameId);
  if (!questions.length) return null;
  const version = await questionsVersion(gameId, db, "game");
  if (body.questionsVersion === undefined || body.questionsVersion === null) throw new QuestionError(FORM_REQUIRED, 409, "form_required");
  if (body.questionsVersion !== version) throw new QuestionError("The host changed the questions — please check your answers", 409, "questions_changed");
  return { version, answers: cleanAnswers(questions, body.answers, [{ attendeeNo: 1, personType: "adult", name }]) };
}

export async function saveGameAnswers(gameId: string, residentId: string, checked: CheckedGameAnswers | null, tx: Tx = db): Promise<void> {
  if (!checked) return;
  await writeAnswers(tx, "game", refOf(gameId, residentId), checked.version, checked.answers, "resident", true);
}

/** A participant who leaves, is removed or is declined takes their answers with them. */
export async function deleteGameAnswers(gameId: string, residentId: string): Promise<void> {
  await db.prepare(`DELETE FROM registration_answers WHERE source_type = 'game' AND source_ref = ?`).run(refOf(gameId, residentId));
}

/** Answers for the host's participant list, by resident. */
export async function gameAnswersByResident(gameId: string, residentIds: string[]): Promise<Map<string, StoredAnswer[]>> {
  const byRef = await readAnswersFor("game", residentIds.map((r) => refOf(gameId, r)));
  return new Map(residentIds.map((r) => [r, byRef.get(refOf(gameId, r)) ?? []]));
}
