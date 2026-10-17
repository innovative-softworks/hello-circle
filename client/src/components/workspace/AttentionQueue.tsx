import type { LucideIcon } from "lucide-react";
import { AdminButton, Box } from "../admin/adminUi";

// "Needs your attention" for the partner and host Overviews (2026-10-16): one
// queue in the admin Overview's row style — icon tile, what and why, one action.

export interface AttentionItem {
  key: string;
  icon: LucideIcon;
  title: string;
  detail?: string;
  /** Brand-tinted icon: something to deal with first. */
  urgent?: boolean;
  /** No button: someone else (HelloCircle) acts next. */
  action?: { label: string; onClick: () => void };
  waitingLabel?: string;
}

export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Box title={`Needs your attention · ${items.length}`} flush>
      <ul className="adm-ov-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.key} className="adm-ov-row ws-q-row" data-urgent={item.urgent || undefined}>
              <span className="adm-ov-tile">
                <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <div className="adm-ov-main">
                <div className="adm-ov-title">{item.title}</div>
                {item.detail && <div className="adm-ov-detail">{item.detail}</div>}
              </div>
              {item.action ? (
                <AdminButton size="sm" onClick={item.action.onClick} aria-label={`${item.action.label}: ${item.title}`}>
                  {item.action.label}
                </AdminButton>
              ) : (
                <span className="adm-ov-kind">{item.waitingLabel ?? "Waiting on HelloCircle"}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Box>
  );
}
