import type { ReactNode } from "react";
import { ActionMenu, type ActionMenuItem } from "../ActionMenu";
import { AdminButton, SelectAllHeader, SelectCell, type RowSelection } from "../admin/adminUi";

// One table for a workspace list of things the partner or host manages
// (programmes, experiences, offers…): title + detail, a few columns, an
// Open button and a ⋯ menu. Rows open on click; on phones they stack.

export interface WsListRow {
  key: string;
  title: ReactNode;
  /** Plain name for accessible labels. */
  name: string;
  detail?: ReactNode;
  leading?: ReactNode;
  cells: ReactNode[];
  onOpen?: () => void;
  openLabel?: string;
  menu?: ActionMenuItem[];
  /** Copied by the row menu's "Copy reference" (an id, a code). */
  copy?: string;
  /** With a table selection: false leaves this row without a checkbox. */
  selectable?: boolean;
}

export function WsListTable({
  caption,
  columns,
  rows,
  selection,
}: {
  caption: string;
  columns: { label: string; num?: boolean }[];
  rows: WsListRow[];
  /** Checkboxes, only for tables whose rows share a real bulk action. */
  selection?: RowSelection;
}) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table adm-table--stack">
        <caption className="adm-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {selection && <SelectAllHeader sel={selection} label={`Select all ${caption.toLowerCase()}`} />}
            {columns.map((c, i) => (
              <th key={c.label} scope="col" className={c.num ? "adm-num" : undefined}>
                {i === 0 ? c.label : c.label}
              </th>
            ))}
            <th scope="col">
              <span className="adm-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-clickable={r.onOpen ? "true" : undefined} onClick={r.onOpen}>
              {selection && <SelectCell sel={selection} rowKey={r.key} label={`Select ${r.name}`} disabled={r.selectable === false} />}
              <td data-label={columns[0].label}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {r.leading}
                  <div style={{ minWidth: 0 }}>
                    {r.onOpen ? (
                      <button
                        type="button"
                        className="btn-reset"
                        style={{ fontWeight: 700, textAlign: "left" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          r.onOpen?.();
                        }}
                      >
                        {r.title}
                      </button>
                    ) : (
                      <strong>{r.title}</strong>
                    )}
                    {r.detail && <div className="adm-note">{r.detail}</div>}
                  </div>
                </div>
              </td>
              {r.cells.map((cell, i) => (
                <td key={i} data-label={columns[i + 1]?.label} className={columns[i + 1]?.num ? "adm-num" : undefined}>
                  {cell}
                </td>
              ))}
              <td onClick={(e) => e.stopPropagation()}>
                <div className="adm-cell-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  {r.onOpen && (
                    <AdminButton size="sm" onClick={r.onOpen} aria-label={`${r.openLabel ?? "Open"} ${r.name}`}>
                      {r.openLabel ?? "Open"}
                    </AdminButton>
                  )}
                  {(() => {
                    // Every row has options: Open, its own actions, Copy reference.
                    const items: ActionMenuItem[] = [
                      ...(r.onOpen ? [{ label: r.openLabel ?? "Open", onSelect: r.onOpen }] : []),
                      ...(r.menu ?? []),
                      { label: "Copy reference", onSelect: () => void navigator.clipboard?.writeText(r.copy ?? r.key).catch(() => undefined) },
                    ];
                    return <ActionMenu label={`More actions for ${r.name}`} buttonText="" className="ws-icon-menu" items={items} />;
                  })()}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Status text as a chip: live-ish states green, attention states amber. */
export function StatusChipText({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = ["approved", "published", "open", "active", "live", "paid", "confirmed"].includes(s)
    ? "good"
    : ["pending", "rejected", "draft", "needs_players", "cancelled", "expired"].includes(s)
      ? "warn"
      : undefined;
  return (
    <span className="adm-chip" data-tone={tone} style={{ textTransform: "capitalize" }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
