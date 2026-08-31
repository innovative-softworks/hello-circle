import { Navigate, useLocation } from "react-router-dom";

// /search is no longer a standalone page (merged into Explore's Results
// Mode — see Explore.tsx) — this preserves every old bookmark/shared link
// (?q=..., or any other param a future caller adds) by forwarding the exact
// same query string onto /explore rather than dropping it.
export function SearchRedirect() {
  const location = useLocation();
  return <Navigate to={`/explore${location.search}`} replace />;
}
