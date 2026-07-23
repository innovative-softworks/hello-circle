import type { CSSProperties, ReactNode } from "react";
import { colors } from "../theme";

interface ChipProps {
  label: ReactNode;
  active: boolean;
  onClick: () => void;
  accent?: "green" | "orange";
  radius?: number;
  padding?: string;
  fontSize?: number;
  disabled?: boolean;
}

export function Chip({
  label,
  active,
  onClick,
  accent = "green",
  radius = 20,
  padding = "8px 15px",
  fontSize = 14,
  disabled = false,
}: ChipProps) {
  const accentColor = accent === "orange" ? colors.orange : colors.green;
  const style: CSSProperties = {
    border: `1.5px solid ${active ? accentColor : colors.borderStrong}`,
    background: active ? accentColor : "#fff",
    color: active ? "#fff" : "#3B423C",
    borderRadius: radius,
    padding,
    fontSize,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  };
  return (
    <button style={style} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
