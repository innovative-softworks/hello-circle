import { useState } from "react";
import { askHelloCircle } from "../api";
import type { AskHelloCircleResponse } from "../api";
import { CentreCard } from "../components/CentreCard";
import { ChatBubble } from "../components/ChatBubble";
import { ChatIcon, SearchIcon } from "../components/icons";
import { ClubCard } from "../components/ClubCard";
import { DiscoverCard } from "../components/DiscoverRow";
import { PageTitle } from "../components/PageTitle";
import { Spinner } from "../components/ui";
import { colors, fonts, radius } from "../theme";
import { fallbackCopy } from "../copy";
import { ExperienceSearchCard } from "../components/ExperienceSearchCard";

// Ask HelloCircle (implementation plan Phase 12) — a chat-style front door
// onto the exact same structured search the /search page already runs
// (server/src/routes/ask.ts reuses runStructuredSearch()). Deliberately
// rule-based, not an LLM — see ask.ts's own comment for why. Every result
// shown here is a real row from the same query the search box would run;
// the "reply" text is templated around real counts, never generated.

const SUGGESTIONS = ["Free activities this weekend in Dublin", "Badminton this evening", "Something for kids under €10", "Swimming near me tomorrow"];

interface Turn {
  role: "user" | "assistant";
  text: string;
  result?: AskHelloCircleResponse;
}

export function AskHelloCircle() {
  const [turns, setTurns] = useState<Turn[]>([
    { role: "assistant", text: "Ask me what you're after — an activity, a time, a place, a budget — and I'll search HelloCircle for it." },
  ]);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);

  const send = async (message: string) => {
    const text = message.trim();
    if (!text || asking) return;
    setDraft("");
    setTurns((t) => [...t, { role: "user", text }]);
    setAsking(true);
    try {
      const result = await askHelloCircle(text);
      setTurns((t) => [...t, { role: "assistant", text: result.reply, result }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", text: e instanceof Error ? e.message : fallbackCopy.generic }]);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 720, margin: "0 auto", padding: "26px 24px 100px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <ChatIcon size={22} style={{ color: colors.green }} />
          <PageTitle style={{ margin: 0 }}>Ask HelloCircle</PageTitle>
        </div>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 24px" }}>
          A simple search assistant — it only ever finds real, currently-open activities and listings, nothing made up.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 24 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: t.role === "user" ? "flex-end" : "flex-start" }}>
              <ChatBubble mine={t.role === "user"}>{t.text}</ChatBubble>
              {t.result && (t.result.activities.length > 0 || t.result.centres.length > 0 || t.result.clubs.length > 0 || t.result.experiences.length > 0) && (
                <div style={{ marginTop: 10, width: "100%" }}>
                  {t.result.activities.length > 0 && (
                    <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6, marginBottom: 10 }}>
                      {t.result.activities.map((a) => (
                        <DiscoverCard key={`${a.kind}-${a.id}`} item={a} isToday={a.date === new Date().toISOString().slice(0, 10)} />
                      ))}
                    </div>
                  )}
                  {t.result.experiences.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 10 }}>
                      {t.result.experiences.map((e) => <ExperienceSearchCard key={e.id} e={e} />)}
                    </div>
                  )}
                  {(t.result.centres.length > 0 || t.result.clubs.length > 0) && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                      {t.result.centres.map((c) => <CentreCard key={c.id} centre={c} />)}
                      {t.result.clubs.map((c) => <ClubCard key={c.id} club={c} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {asking && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <ChatBubble mine={false}>
                <Spinner size={16} />
              </ChatBubble>
            </div>
          )}
        </div>

        {turns.length <= 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                style={{ background: colors.panel, border: "none", borderRadius: radius.pill, padding: "8px 14px", fontSize: 13.5, cursor: "pointer" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div style={{ position: "sticky", bottom: 16, display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <SearchIcon size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(draft)}
              placeholder="Ask something…"
              style={{ width: "100%", padding: "14px 14px 14px 40px", borderRadius: 14, border: `1px solid ${colors.border}`, fontSize: 15, outline: "none", boxShadow: "0 8px 30px rgba(30,40,32,.08)" }}
            />
          </div>
          <button
            onClick={() => send(draft)}
            disabled={asking || !draft.trim()}
            style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 14, padding: "0 22px", fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}
          >
            Ask
          </button>
        </div>
      </section>
    </div>
  );
}
