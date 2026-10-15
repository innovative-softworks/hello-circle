import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/** Workspace tab kept in the URL (`?tab=`), so Back/Forward, refresh and
 * shared links land on the same tab — same model as the admin workspace.
 * An unknown or missing value falls back to `fallback`. Changing tab pushes
 * a history entry and drops the other query params, which belong to the
 * previous tab (e.g. a one-off `?setup=1`). */
export function resolveUrlTab<T extends string>(raw: string | null, keys: readonly T[], fallback: T): T {
  return raw !== null && (keys as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function useUrlTab<T extends string>(keys: readonly T[], fallback: T, param = "tab"): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const tab = resolveUrlTab(params.get(param), keys, fallback);
  const setTab = useCallback(
    (next: T) => {
      if (next === tab) return;
      setParams(next === fallback ? {} : { [param]: next });
    },
    [tab, fallback, param, setParams]
  );
  return [tab, setTab];
}

/** A list filter kept in the URL next to `?tab=` (search text, status view,
 * sort, page…), so opening a record and coming back — or sharing the link —
 * restores the list exactly. Updates replace the history entry, so typing in
 * a search box doesn't add a Back step per keystroke. The default value is
 * left out of the URL. */
export function useUrlParam<T extends string>(name: string, fallback: T): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = (params.get(name) as T | null) ?? fallback;
  const set = useCallback(
    (next: T) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === fallback || next === "") p.delete(name);
          else p.set(name, next);
          return p;
        },
        { replace: true }
      ),
    [name, fallback, setParams]
  );
  return [value, set];
}

/** The record open on top of a list (`?record=<key>`). Opening pushes a
 * history entry (Back returns to the list); closing removes the parameter and
 * keeps every list filter. */
export function useRecordParam(name = "record"): [string | null, (key: string) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const record = params.get(name);
  const open = useCallback(
    (key: string) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set(name, key);
        return p;
      }),
    [name, setParams]
  );
  const close = useCallback(
    () =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.delete(name);
        return p;
      }),
    [name, setParams]
  );
  return [record, open, close];
}
