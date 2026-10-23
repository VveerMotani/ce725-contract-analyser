// Document quality strip under the report figures: pages with text, scanned, struck through, formula images,
// documents the contract mentions but the package lacks. Each count opens its page list; a page opens the source panel.
import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from "react";
import { api } from "../api";
import { useAsync, useRun } from "../context";
import type { Package, PageInfo } from "../types";
import { cx } from "../components/ui";

interface Ref { doc: string; page: number; quote?: string; note?: string }
interface Item { key: string; n: number; label: string; colour?: string; refs: Ref[] }

const C = {
  text: "var(--line-strong)",
  scanned: "var(--warn)",
  garbled: "color-mix(in srgb, var(--warn) 55%, var(--surface))",
  struck: "var(--bad)",
  image: "var(--accent)",
};

/** Colour of one page in the bar: struck > scanned > unreadable > formula image > text. */
function pageColour(p: PageInfo): string {
  if (p.strike_hits?.length) return C.struck;
  if (p.low_text) return C.scanned;
  if (p.garbled) return C.garbled;
  if (p.formula_image) return C.image;
  return C.text;
}

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

function items(pkg: Package): { pages: PageInfo[]; text: number; list: Item[] } {
  const pages = pkg.pages ?? [];
  const ref = (p: PageInfo, quote?: string, note?: string): Ref => ({ doc: p.doc_id, page: p.page, quote, note });
  const scanned = pages.filter((p) => p.low_text);
  const garbled = pages.filter((p) => p.garbled && !p.low_text);
  const struck = pages.filter((p) => p.strike_hits?.length);
  const formula = pages.filter((p) => p.formula_image);
  const choice = pages.filter((p) => p.choice_fields?.length);
  const visual = pages.filter((p) => p.needs_visual);
  const missing = pkg.missing_references ?? [];
  const list: Item[] = [
    { key: "scanned", n: scanned.length, label: "scanned", colour: C.scanned, refs: scanned.map((p) => ref(p)) },
    { key: "garbled", n: garbled.length, label: "unreadable text", colour: C.garbled, refs: garbled.map((p) => ref(p)) },
    { key: "struck", n: struck.length, label: "struck-through", colour: C.struck, refs: struck.map((p) => ref(p, p.strike_hits[0].context || p.strike_hits[0].word, `“${cut(p.strike_hits[0].word, 34)}”${p.strike_hits.length > 1 ? ` +${p.strike_hits.length - 1}` : ""}`)) },
    { key: "formula", n: formula.length, label: s(formula.length, "formula image", "formula images"), colour: C.image, refs: formula.map((p) => ref(p)) },
    { key: "choice", n: choice.length, label: s(choice.length, "option field", "option fields"), refs: choice.map((p) => ref(p, undefined, p.choice_fields.join(", "))) },
    { key: "visual", n: visual.length, label: "read as image", refs: visual.map((p) => ref(p, undefined, cut(p.visual_reasons?.[0] ?? "", 40) || undefined)) },
    { key: "missing", n: missing.length, label: s(missing.length, "document missing", "documents missing"), refs: missing.map((m) => ({ doc: m.doc_id, page: m.page, quote: m.quote, note: m.label })) },
  ];
  return { pages, text: pages.filter((p) => !p.low_text && !p.garbled).length, list: list.filter((i) => i.n > 0) };
}

function PageList({ item, multiDoc, docNo, onPick }: { item: Item; multiDoc: boolean; docNo: (d: string) => string; onPick: (r: Ref) => void }) {
  const pageText = (r: Ref) => `${multiDoc ? `${docNo(r.doc)} · ` : ""}p. ${r.page}`;
  const withNotes = item.refs.some((r) => r.note);
  return (
    <>
      <div className="text-[12px] text-muted"><span className="tnum">{item.n}</span> {item.label}</div>
      {withNotes ? (
        <ul className="mt-1.5 flex flex-col">
          {item.refs.map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 border-b border-line py-1 last:border-0">
              <span className="min-w-0 break-words text-ink-2">{r.note}</span>
              {r.page > 0 ? <button type="button" onClick={() => onPick(r)} className="shrink-0 text-accent-ink hover:underline tnum">{pageText(r)}</button>
                : <span className="shrink-0 text-muted">—</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1">
          {item.refs.map((r, i) => <button key={i} type="button" onClick={() => onPick(r)} className="text-accent-ink hover:underline tnum">{pageText(r)}</button>)}
        </div>
      )}
    </>
  );
}

export function DocQuality() {
  const { meta, openPage } = useRun();
  const pkg = useAsync(() => (meta ? api.package(meta.package_id).catch(() => undefined) : Promise.resolve(undefined)), [meta?.package_id]);
  const data = useMemo(() => (pkg.data ? items(pkg.data) : null), [pkg.data]);
  const [open, setOpen] = useState<{ key: string; left: number; top: number; w: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !(t instanceof Element && t.closest("[data-dq-chip]"))) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    const onScroll = () => setOpen(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  if (!data || data.pages.length === 0) return null;
  const files = pkg.data?.files ?? [];
  const multiDoc = new Set(data.pages.map((p) => p.doc_id)).size > 1;
  const docNo = (d: string) => { const i = files.findIndex((f) => f.doc_id === d); return i >= 0 ? `doc ${i + 1}` : d; };
  const current = open ? data.list.find((i) => i.key === open.key) : undefined;

  const toggle = (key: string, e: RMouseEvent<HTMLButtonElement>) => {
    if (open?.key === key) { setOpen(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = Math.min(320, vw - 32);
    setOpen({ key, left: Math.max(16, Math.min(r.left, vw - 16 - w)), top: r.bottom + 6, w });
  };
  const pick = (r: Ref, label: string) => {
    setOpen(null);
    openPage(r.page, r.quote ?? "", r.doc || "d1", `Page ${r.page}`, label.charAt(0).toUpperCase() + label.slice(1));
  };
  const onBar = (e: RMouseEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const i = Math.min(data.pages.length - 1, Math.max(0, Math.floor(((e.clientX - b.left) / b.width) * data.pages.length)));
    const p = data.pages[i];
    openPage(p.page, "", p.doc_id || "d1", `Page ${p.page}`, "Document");
  };

  // borderless until open, so the whole strip reads as one factsheet line
  const chip = "group inline-flex items-center gap-1 whitespace-nowrap rounded border border-transparent px-1 py-px text-[12.5px] text-ink-2";
  const n = data.pages.length;

  return (
    <div className="mt-5" aria-label="Document quality">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
        <span className="whitespace-nowrap"><span className="text-ink-2 tnum">{n}</span> pages</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: C.text }} aria-hidden /><span className="text-ink-2 tnum">{data.text}</span> text
        </span>
        {data.list.map((it) => (
          <button key={it.key} type="button" data-dq-chip aria-expanded={open?.key === it.key} aria-haspopup="dialog" onClick={(e) => toggle(it.key, e)}
            className={cx(chip, "hover:text-ink", open?.key === it.key && "border-accent text-ink")}>
            {it.colour && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: it.colour }} aria-hidden />}
            <span className="tnum underline decoration-line-strong underline-offset-[3px] group-hover:decoration-accent">{`${it.n} ${it.label}`}</span>
          </button>
        ))}
      </div>
      <svg className="mt-2 block h-[6px] w-full cursor-pointer" viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" onClick={onBar}
        role="img" aria-label={`Page bar: ${n} pages, ${data.list.map((i) => `${i.n} ${i.label}`).join(", ")}`}>
        {data.pages.map((p, i) => <rect key={i} x={i} y={0} width={1.02} height={1} style={{ fill: pageColour(p) }}><title>{`p. ${p.page}`}</title></rect>)}
      </svg>
      {open && current && (
        <div ref={pop} role="dialog" aria-label={current.label} style={{ left: open.left, top: open.top, width: open.w }}
          className="scroll-thin fixed z-40 max-h-[280px] overflow-y-auto rounded-md border border-line bg-surface p-3 text-[13px] shadow-lg">
          <PageList item={current} multiDoc={multiDoc} docNo={docNo} onPick={(r) => pick(r, current.label)} />
        </div>
      )}
    </div>
  );
}
