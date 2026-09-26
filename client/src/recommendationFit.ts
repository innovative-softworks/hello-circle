// Plain-language fit label for a personalised result (Release 1). Derived
// from how many real match reasons the server returned — never a
// percentage, which would imply precision the scoring doesn't have.
// Release 4 moves this onto the weighted score; the labels stay the same.

export type FitLabel = "Great fit" | "Good fit";

export function fitLabel(reasons: readonly string[] | undefined): FitLabel | null {
  const n = reasons?.length ?? 0;
  if (n >= 2) return "Great fit";
  if (n === 1) return "Good fit";
  return null;
}
