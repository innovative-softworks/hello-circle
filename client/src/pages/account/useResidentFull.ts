import { useCallback, useEffect, useState } from "react";
import { fetchResidentFull } from "../../api";
import type { ResidentFull } from "../../types";

/** The signed-in resident's full profile for one account page, with explicit
 * loading / failed states — the old panels showed defaults (or nothing) when
 * this request failed, which looked like real saved settings. */
export function useResidentFull() {
  const [data, setData] = useState<ResidentFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setFailed(false);
    return fetchResidentFull()
      .then(({ resident }) => {
        if (!resident) throw new Error("Not signed in");
        setData(resident);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patch = useCallback((p: Partial<ResidentFull>) => setData((d) => (d ? { ...d, ...p } : d)), []);

  return { data, loading, failed, reload, patch };
}
