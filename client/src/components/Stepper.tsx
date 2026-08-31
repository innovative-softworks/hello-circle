import { colors } from "../theme";

interface StepperProps {
  labels: string[];
  current: number; // 1-based
  accent?: "green" | "orange";
}

const srOnly: import("react").CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function Stepper({ labels, current, accent = "green" }: StepperProps) {
  const accentColor = accent === "orange" ? colors.orange : colors.green;
  return (
    <nav aria-label={`Step ${current} of ${labels.length}: ${labels[current - 1]}`}>
      <ol style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 30, maxWidth: 640, listStyle: "none", padding: 0 }}>
        {labels.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          const dotBg = done || active ? accentColor : "#fff";
          const dotFg = done || active ? "#fff" : "#8A928B";
          const dotBorder = done || active ? accentColor : colors.borderStrong;
          const labelColor = done || active ? colors.text : colors.faint;
          const lineColor = done ? accentColor : "#E2DFD6";
          return (
            <li key={label} aria-current={active ? "step" : undefined} style={{ display: "flex", alignItems: "center", flex: n < labels.length ? 1 : undefined }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: dotBg,
                    color: dotFg,
                    border: `1.5px solid ${dotBorder}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 14,
                    flex: "none",
                  }}
                >
                  {n}
                </div>
                <span className="stepper-label" style={{ fontSize: 14, fontWeight: 600, color: labelColor, whiteSpace: "nowrap" }}>
                  {label}
                  {done && <span style={srOnly}> (completed)</span>}
                </span>
              </div>
              {n < labels.length && (
                <div aria-hidden="true" className="stepper-line" style={{ flex: 1, height: 1.5, background: lineColor, margin: "0 14px", minWidth: 16 }} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
