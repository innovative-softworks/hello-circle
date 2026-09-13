import { useState } from "react";
import { ChevronDownIcon } from "../icons";
import { colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

const FAQS: { q: string; a: string }[] = [
  { q: "Who can list on HelloCircle?", a: "Community centres, sports clubs, and other local venues and activity providers looking to reach people nearby." },
  { q: "What types of spaces can I add?", a: "Courts, pitches, halls, rooms, studios and other bookable facilities — whatever your venue actually offers." },
  { q: "Can I list multiple facilities?", a: "Yes — a venue can have any number of named rooms or spaces, each with its own capacity and availability." },
  { q: "Can I control availability?", a: "Yes — you set when each space or activity can be discovered and booked, and update it any time." },
  { q: "Can people book directly?", a: "Where booking is supported for your listing, yes — enquiries and bookings land in one place on your dashboard." },
  { q: "Can I edit my listing later?", a: "Yes — photos, descriptions and facility details can all be updated after your listing goes live." },
  { q: "Can clubs and activity providers join?", a: "Yes — sports clubs and community activity providers are already part of HelloCircle, alongside venues." },
  { q: "What does it cost?", a: "Pricing and booking options may vary as HelloCircle develops its venue partner programme." },
];

export function VendorFAQ({ onOpen }: { onOpen?: (question: string) => void }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "64px 24px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 8 }}>
        <span style={{ color: FV_ACCENT }}>/</span> Questions
      </div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 3vw, 32px)", letterSpacing: "-.02em", margin: "0 0 8px" }}>
        Frequently asked questions
      </h2>
      <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 24 }}>
        {FAQS.map((f, i) => {
          const open = openIndex === i;
          return (
            <div key={f.q} style={{ borderBottom: `1px solid ${colors.border}` }}>
              <button
                onClick={() => {
                  const next = open ? null : i;
                  setOpenIndex(next);
                  if (next !== null) onOpen?.(f.q);
                }}
                aria-expanded={open}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: "16px 4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: fonts.display,
                  fontWeight: 700,
                  fontSize: 15,
                  color: colors.text,
                }}
              >
                <span style={{ color: open ? FV_ACCENT : colors.text }}>{f.q}</span>
                <ChevronDownIcon size={16} style={{ color: open ? FV_ACCENT : colors.mutedLight, flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
              </button>
              {open && (
                <p className="fade-panel" style={{ margin: "0 0 18px", padding: "0 4px", fontSize: 14, color: colors.muted, lineHeight: 1.6 }}>
                  {f.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
