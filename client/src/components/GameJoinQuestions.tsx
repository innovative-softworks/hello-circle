import { useState } from "react";
import { FormQuestions, type AnswersDraft } from "./experience/AttendeeFields";
import { missingAnswers, withDefaults } from "./experience/attendeeSlots";
import type { Game } from "../types";

// Phase N (docs/participation-expansion/24) — the host's questions when
// joining an activity (an approved list: level, position, equipment, team,
// arriving on time). Shown in the join confirmation; a game that asks
// questions never joins in one tap. Answers go to the host only.

export function useGameJoinQuestions(game: Game) {
  const form = game.participationQuestions ?? { questions: [], questionsVersion: 0 };
  const asks = form.questions.some((q) => q.inputType !== "info");
  const [answers, setAnswers] = useState<AnswersDraft>({ booking: {}, attendees: [{}] });
  const people = [{ name: "You", personType: "adult" as const, guardian: "" as const }];
  const filled = withDefaults(form.questions, people, answers);
  const missing = asks ? missingAnswers(form.questions, people, filled) : [];
  return {
    asks,
    missing,
    payload: asks ? { answers: filled, questionsVersion: form.questionsVersion } : undefined,
    block: asks ? (
      <div style={{ marginTop: 12 }}>
        <FormQuestions
          questions={form.questions}
          answers={answers}
          onAnswers={setAnswers}
          person={{ name: "", personType: "adult" }}
          title="A few questions from the host"
          fe={{ control: (id: string) => ({ id }), messageFor: () => undefined, clearField: () => undefined }}
        />
        {missing.length > 0 && <p style={{ margin: "8px 0 0", fontSize: 13 }}>Still to answer: {missing.map((m) => m.message.replace(/^You: /, "")).join("; ")}</p>}
      </div>
    ) : null,
  };
}
