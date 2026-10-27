import { useState } from "react";
import { dismissCircleWelcome } from "../../api";
import type { Circle } from "../../types";
import { Button } from "../ui";

// Circle Experience 2.0 — First-Time Friendly (circles.first_time_friendly).
//
// CircleWelcomePanel: shown once after joining (circle_members.welcomed_at).
// What to expect at the next activity now lives in the "Next up" card
// (CircleNextUp.tsx), built only from what the organiser entered.

export type CircleTabKey = "home" | "activities" | "discussions" | "polls" | "members" | "memories" | "about";

export function CircleWelcomePanel({
  circle,
  onGo,
  onDismissed,
  hasGuidelines,
}: {
  circle: Circle;
  onGo: (tab: CircleTabKey) => void;
  onDismissed: () => void;
  hasGuidelines: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const dismiss = async () => {
    setBusy(true);
    try {
      await dismissCircleWelcome(circle.id);
    } catch {
      // Not worth blocking on: it only means the welcome shows again next visit.
    } finally {
      setBusy(false);
      onDismissed();
    }
  };
  const go = (tab: CircleTabKey) => {
    void dismiss();
    onGo(tab);
  };
  return (
    <section className="ce-welcome" aria-labelledby="ce-welcome-title">
      <h2 id="ce-welcome-title">Welcome to {circle.name}.</h2>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>You're in. Here's where to start — no pressure to do all of it.</p>
      <ul>
        <li>
          <button type="button" onClick={() => go("activities")}>
            Explore upcoming activities<span>See what's planned and join one.</span>
          </button>
        </li>
        {hasGuidelines && (
          <li>
            <button type="button" onClick={() => go("home")}>
              Read the Circle's guidelines<span>Who it's for and what it values.</span>
            </button>
          </li>
        )}
        <li>
          <button type="button" onClick={() => go("discussions")}>
            Introduce yourself<span>Only if you'd like to — say hello in the Circle chat.</span>
          </button>
        </li>
      </ul>
      <Button variant="ghost" onClick={dismiss} disabled={busy}>
        Got it
      </Button>
    </section>
  );
}
