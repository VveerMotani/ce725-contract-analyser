// A contract word with a dotted underline; its plain definition shows on hover, focus or tap.
// The tooltip is portalled and fixed-positioned, clamped to the viewport so it never widens the page.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type GlossKey } from "../lib/glossary";
import { cx } from "./ui";

const W = 264;
const GAP = 6;
const EDGE = 8;

// only one definition open at a time
let closeOpen: (() => void) | null = null;

export function Term({ k, children, className }: { k: GlossKey; children?: ReactNode; className?: string }) {
  const g = GLOSSARY[k];
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; w: number } | null>(null);
  const lastPointer = useRef<string>("");
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  const close = useCallback(() => { clearTimeout(hideTimer.current); setOpen(false); }, []);
  const show = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (closeOpen && closeOpen !== close) closeOpen();
    closeOpen = close;
    setOpen(true);
  }, [close]);
  const hideSoon = () => { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setOpen(false), 120); };

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth;
    const w = Math.min(W, vw - 2 * EDGE);
    const left = Math.max(EDGE, Math.min(r.left, vw - EDGE - w));
    const h = tip.current?.offsetHeight ?? 0;
    const below = r.bottom + GAP;
    const top = h && below + h > window.innerHeight - EDGE && r.top - GAP - h > EDGE ? r.top - GAP - h : below;
    setPos({ left, top, w });
  }, []);

  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open, place]);
  // second pass once the tooltip height is known (flip above when there is no room below)
  useLayoutEffect(() => { if (open && pos && tip.current) place(); }, [open, pos?.w]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !tip.current?.contains(t)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, close, place]);

  useEffect(() => () => { clearTimeout(hideTimer.current); if (closeOpen === close) closeOpen = null; }, [close]);

  const onClick = (e: MouseEvent) => {
    // never trigger the card or link around the word
    e.preventDefault();
    e.stopPropagation();
    if (lastPointer.current === "mouse") show();
    else if (open) close();
    else show();
    lastPointer.current = "";
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
    if (e.key === "Escape" && open) { e.stopPropagation(); close(); }
  };

  return (
    <>
      <button ref={btn} type="button" aria-describedby={id} aria-expanded={open}
        onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") show(); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hideSoon(); }}
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) show(); }}
        onBlur={hideSoon}
        onClick={onClick} onKeyDown={onKeyDown}
        className={cx("inline cursor-help p-0 text-left underline decoration-muted decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-accent focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", className)}>
        {children ?? g.head}
      </button>
      <span id={id} hidden>{g.head}: {g.def}</span>
      {open && createPortal(
        <span ref={tip} role="tooltip" aria-hidden
          onPointerEnter={(e) => { if (e.pointerType === "mouse") clearTimeout(hideTimer.current); }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") hideSoon(); }}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, width: pos?.w ?? W, visibility: pos ? "visible" : "hidden" }}
          className="fixed z-50 block rounded-md border border-line bg-surface px-3 py-2.5 text-left font-sans text-[13px] font-normal normal-case leading-snug tracking-normal text-ink-2 shadow-lg">
          <span className="block text-[12.5px] font-semibold text-ink">{g.head}</span>
          <span className="mt-0.5 block">{g.def}</span>
        </span>,
        document.body,
      )}
    </>
  );
}

/** Wraps the first case-insensitive match of `word` in `text` with <Term>; the whole text when there is no match. */
export function TermIn({ text, k, word }: { text: string; k: GlossKey; word?: string | RegExp }) {
  if (!word) return <Term k={k}>{text}</Term>;
  const re = typeof word === "string" ? new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : word;
  const m = text.match(re);
  if (!m || m.index == null) return <Term k={k}>{text}</Term>;
  return <>{text.slice(0, m.index)}<Term k={k}>{m[0]}</Term>{text.slice(m.index + m[0].length)}</>;
}
