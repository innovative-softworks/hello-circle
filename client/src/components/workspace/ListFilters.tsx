import { useSearchParams } from "react-router-dom";
import { AdminButton, EmptyMessage, SearchField, SelectField, Toolbar, matches } from "../admin/adminUi";

// Shared list filters for workspace lists (partner / host) that had none:
// a search box plus optional selects, kept in the URL (shareable, survives
// Back) like the admin lists. Rendered only when the list has enough rows
// to need it. `apply()` filters client-side over the already-loaded rows.

export interface ListFilterSelect<T> {
  /** URL parameter name, e.g. "status". */
  param: string;
  label: string;
  options: { value: string; label: string }[];
  /** The row's value for this select… */
  get?: (row: T) => string;
  /** …or, for rows with several values (e.g. teams), whether it matches. */
  test?: (row: T, value: string) => boolean;
}

export function useListFilters<T>(opts: { param?: string; search: (row: T) => (string | null | undefined)[]; selects?: ListFilterSelect<T>[] }) {
  const [params, setParams] = useSearchParams();
  const qParam = opts.param ?? "q";
  const q = params.get(qParam) ?? "";
  const values: Record<string, string> = Object.fromEntries((opts.selects ?? []).map((s) => [s.param, params.get(s.param) ?? "all"]));
  const set = (name: string, value: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (!value || value === "all") p.delete(name);
        else p.set(name, value);
        return p;
      },
      { replace: true }
    );
  const active = !!q || Object.values(values).some((v) => v !== "all");
  const clear = () =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete(qParam);
        for (const s of opts.selects ?? []) p.delete(s.param);
        return p;
      },
      { replace: true }
    );
  const apply = (rows: T[]) =>
    rows.filter((r) => matches(q, ...opts.search(r)) && (opts.selects ?? []).every((s) => values[s.param] === "all" || (s.test ? s.test(r, values[s.param]) : s.get?.(r) === values[s.param])));
  return { q, setQ: (v: string) => set(qParam, v), values, set, active, clear, apply, selects: opts.selects ?? [] };
}

export function ListFilterBar<T>({ state, searchLabel, placeholder }: { state: ReturnType<typeof useListFilters<T>>; searchLabel: string; placeholder?: string }) {
  return (
    <Toolbar label={searchLabel}>
      <SearchField label={searchLabel} value={state.q} onChange={state.setQ} placeholder={placeholder} />
      {state.selects.map((s) => (
        <SelectField key={s.param} label={s.label} value={state.values[s.param]} onChange={(v) => state.set(s.param, v)} options={[{ value: "all", label: `All` }, ...s.options]} />
      ))}
    </Toolbar>
  );
}

/** Filtered to nothing: say so and offer the way back (never a blank list). */
export function NoMatches({ onClear, noun = "items" }: { onClear: () => void; noun?: string }) {
  return <EmptyMessage title={`No ${noun} match these filters`} action={<AdminButton size="sm" onClick={onClear}>Clear filters</AdminButton>} />;
}
