/* The small, repeated pieces of the prototype's markup, each one a class that is already in
   console.css. Nothing here invents a style: every className below appears verbatim in the
   prototype. */

import type { CSSProperties, ReactNode } from "react";
import { money } from "@/lib/format";

/* ---- .chip — 166 sites in the prototype ------------------------------------------------------ */
export function Chip({
  on,
  title,
  disabled,
  onClick,
  id,
  style,
  children,
}: {
  on?: boolean;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
  id?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      className={`chip ${on ? "on" : ""}`}
      title={title}
      disabled={disabled}
      style={style}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---- .card / .ch / .cb — the frame every block on every screen sits in ------------------------ */
export function Card({
  title,
  head,
  plain,
  bodyClass,
  className,
  style,
  children,
}: {
  /** the <h3> in the card's header strip */
  title?: ReactNode;
  /** anything else in that strip, after the title */
  head?: ReactNode;
  /** render children directly under .card, with no .cb — for a card that holds a table or a list */
  plain?: boolean;
  bodyClass?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div className={`card ${className ?? ""}`.trim()} style={style}>
      {(title != null || head != null) && (
        <div className="ch">
          {title != null && <h3>{title}</h3>}
          {head}
        </div>
      )}
      {plain ? children : <div className={`cb ${bodyClass ?? ""}`.trim()}>{children}</div>}
    </div>
  );
}

/* ---- .rag — the only place green, amber and red are spent: whether a lead is in trouble ------- */
export type RagLevel = "green" | "amber" | "red";

export function Rag({ r, title }: { r: RagLevel; title?: string }) {
  return <span className={`rag ${r}`} title={title} />;
}

/* ---- money() in a mono span — ₹ crores and lakhs, never a raw number. 03-app.js:451 ----------- */
export function Money({ v, className }: { v: number; className?: string }) {
  return <span className={`mono ${className ?? ""}`.trim()}>{money(v)}</span>;
}

/* ---- a recorded timestamp, as the prototype prints one: small, mono, never re-formatted ------- */
export function Stamp({ at, className }: { at: string; className?: string }) {
  return <span className={`sm mono ${className ?? ""}`.trim()}>{at}</span>;
}

/* ---- .empty — 19 sites. An empty list says what empty means, never nothing. ------------------- */
export function Empty({ children }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/* ---- .fi — a labelled field. The <i> after the label is the prototype's quiet hint. ----------- */
export function Field({
  label,
  hint,
  style,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <label className="fi" style={style}>
      <span>
        {label}
        {hint != null && <i>{hint}</i>}
      </span>
      {children}
    </label>
  );
}

/* ---- .tgl — an on/off that is not a chip: a setting, not a filter ----------------------------- */
export function Toggle({
  on,
  disabled,
  onClick,
  title,
  children,
}: {
  on?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tgl ${on ? "on" : ""}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---- .dialrow — a figure with a minus and a plus. The prototype's dial(), 03-app.js:5723 ------
   Read-only when the seat may not change it: the controls disappear rather than refusing. */
export function Num({
  label,
  value,
  suffix,
  edit,
  id,
  onDown,
  onUp,
  style,
}: {
  label: ReactNode;
  value: ReactNode;
  suffix?: ReactNode;
  edit?: boolean;
  /** the prototype ids these `dl-<k>-d` / `dl-<k>-u` so focus survives a redraw */
  id?: string;
  onDown?: () => void;
  onUp?: () => void;
  style?: CSSProperties;
}) {
  return (
    <div className="dialrow" style={style}>
      <span>{label}</span>
      <div className="sp" />
      {edit && (
        <button type="button" className="chip" id={id ? `dl-${id}-d` : undefined} onClick={onDown}>
          −
        </button>
      )}
      <b className="mono">
        {value}
        {suffix}
      </b>
      {edit && (
        <button type="button" className="chip" id={id ? `dl-${id}-u` : undefined} onClick={onUp}>
          +
        </button>
      )}
    </div>
  );
}
