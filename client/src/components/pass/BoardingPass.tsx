import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { KIND_LABEL, useCodeSvg, type PassKind, type PassTone } from "./Pass";
import "./pass.css";
import "./boardingPass.css";

// The horizontal boarding pass (owner 2026-10-28): the type colour down the
// left edge, the plan in boarding-pass columns, a perforation and a tear-off
// stub with the check-in code. Same kind colours and tones as Pass.tsx
// (pass.css). Used for My Life "Your next plan" and the booking page; the
// three original looks (wallet / ticket / lanyard) stay where they were.
// Stacks on phones with the stub underneath.

export interface BoardingPassProps {
  kind: PassKind;
  tone: PassTone;
  /** The status pill: "You're going", "Today · check in when you arrive", … */
  status: string;
  title: string;
  titleHref?: string | null;
  titleId?: string;
  as?: "h1" | "h2" | "h3";
  /** Small line opposite the status ("HelloCircle · Clontarf Walkers"). */
  topRight?: string | null;
  /** The boarding-pass row: Date | Time | Where | Admit. `big` = display size. */
  columns: { label: string; value: ReactNode; big?: boolean }[];
  /** Up to three smaller facts under the row. */
  extra?: [string, ReactNode][];
  note?: ReactNode;
  /** The booking reference, shown under the code. */
  reference?: string | null;
  /** What the code holds when it isn't the reference (activity check-in code). */
  code?: string | null;
  /** False while a place isn't good to use yet: the code is greyed out. */
  codeActive?: boolean;
  /** Under the code when there's no reference ("Check yourself in when you arrive"). */
  stubText?: string;
  /** No code at all: what the stub says instead. */
  emptyStub?: { title: string; text: string };
  /** Short date/time line at the foot of the stub. */
  stubLine?: string | null;
  /** A rotated stamp over the stub ("Completed", "Cancelled"). */
  stamp?: string | null;
  /** Actions, in order: main button, then links. */
  children?: ReactNode;
}

export function BoardingPass({ kind, tone, status, title, titleHref, titleId, as = "h3", topRight, columns, extra, note, reference, code, codeActive = true, stubText, emptyStub, stubLine, stamp, children }: BoardingPassProps) {
  const payload = code ?? reference ?? null;
  const svg = useCodeSvg(payload);
  const Title = as;
  return (
    // The wrapper is a size container: the pass lays itself out by its own width, not the screen's.
    <div className="np-bp-wrap">
    <article className={`hc-pass np-bp hc-pass-tone-${tone}`} data-kind={kind} aria-label={`${KIND_LABEL[kind]} pass: ${status}`}>
      <div className="np-bp-spine" aria-hidden="true">
        <span>{KIND_LABEL[kind]}</span>
      </div>
      <div className="np-bp-main">
        <div className="np-bp-top">
          <span className="hc-pass-status">
            <i aria-hidden="true" />
            {status}
          </span>
          {topRight && <span className="np-bp-brand">{topRight}</span>}
        </div>
        <Title className="np-bp-title" id={titleId}>
          {titleHref ? <Link to={titleHref}>{title}</Link> : title}
        </Title>
        {columns.length > 0 && (
          <dl className="np-bp-cols">
            {columns.map((c) => (
              <div key={c.label} className={c.big ? undefined : "np-bp-flex"}>
                <dt>{c.label}</dt>
                <dd className={c.big ? "np-bp-big" : undefined}>{c.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {!!extra?.length && (
          <dl className="np-bp-extra">
            {extra.slice(0, 3).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {note && <p className="hc-pass-note np-bp-note">{note}</p>}
        {children && <div className="np-bp-actions">{children}</div>}
      </div>
      <div className="np-bp-stub">
        {payload ? (
          <>
            <div className={`hc-pass-code np-bp-code${codeActive ? "" : " is-dim"}`} aria-hidden="true" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
            <span className="np-bp-label">{!codeActive && !stamp ? "Not active yet" : reference ? "Reference" : stamp ? "Used" : "Show at check-in"}</span>
            {reference ? <span className="hc-pass-ref">{reference}</span> : stubText ? <span className="np-bp-small">{stubText}</span> : null}
          </>
        ) : emptyStub ? (
          <span className="np-bp-small">
            <b>{emptyStub.title}</b>
            {emptyStub.text}
          </span>
        ) : null}
        {stubLine && (
          <span className="np-bp-stubline" aria-hidden="true">
            {stubLine}
          </span>
        )}
        {stamp && <span className="hc-pass-stamp">{stamp}</span>}
      </div>
    </article>
    </div>
  );
}
