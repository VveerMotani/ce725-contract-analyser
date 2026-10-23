// S2 Package check: files, hashes, pages, text per page, visual-pass pages, missing documents.
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Copy, Eye, FileQuestion, FileText, Image as ImageIcon, Layers, Play, ScanLine, Strikethrough } from "lucide-react";
import { api } from "../api";
import { useApp, useAsync, useRun } from "../context";
import type { Package, PageInfo } from "../types";
import { num, shortHash } from "../lib/format";
import { Button, Card, Chip, Collapsible, EmptyState, ErrorBox, KpiTile, PageHeader, PageLink, Quote, Segmented, Spinner, cx } from "../components/ui";

const TAG_LABEL: Record<string, string> = {
  notice: "Notice / RFP", gcc: "General conditions", schedules: "Schedules", special: "Special conditions", amendment: "Amendment", boq: "BOQ", other: "Other",
};

function reasonIcon(r: string) {
  const l = r.toLowerCase();
  if (l.includes("text layer") || l.includes("scan")) return <ScanLine className="h-3 w-3" />;
  if (l.includes("choice") || l.includes("strike")) return <Strikethrough className="h-3 w-3" />;
  if (l.includes("image") || l.includes("formula")) return <ImageIcon className="h-3 w-3" />;
  return <Eye className="h-3 w-3" />;
}

export function PackageView({ pkg, actions }: { pkg: Package; actions?: ReactNode }) {
  const { openSource } = useApp();
  const [doc, setDoc] = useState(pkg.files[0]?.doc_id ?? "d1");
  const pages = pkg.pages ?? [];
  const docPages = pages.filter((p) => p.doc_id === doc);
  const visual = pages.filter((p) => p.needs_visual);
  const lowText = pages.filter((p) => p.low_text);
  const totalPages = pkg.files.reduce((a, f) => a + f.page_count, 0);
  const open = (p: PageInfo, quote = "") => openSource({ packageId: pkg.package_id, docId: p.doc_id, page: p.page, quote, title: `${p.doc_id} page ${p.page}` });

  const byReason = useMemo(() => {
    const m = new Map<string, PageInfo[]>();
    visual.forEach((p) => (p.visual_reasons.length ? p.visual_reasons : ["Flagged"]).forEach((r) => m.set(r, [...(m.get(r) ?? []), p])));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [visual]);

  const chart = docPages.map((p) => ({ page: p.page, chars: p.char_count, low: p.low_text, visual: p.needs_visual }));
  const median = useMemo(() => {
    const s = docPages.map((p) => p.char_count).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  }, [docPages]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile label="Files" value={pkg.files.length} icon={<FileText className="h-3.5 w-3.5" />} />
        <KpiTile label="Pages" value={num(totalPages)} icon={<Layers className="h-3.5 w-3.5" />} />
        <KpiTile label="Visual pass" value={visual.length} sub="pages read as images" tone={visual.length ? "violet" : undefined} icon={<Eye className="h-3.5 w-3.5" />} />
        <KpiTile label="Low / no text" value={lowText.length} sub="scans or image pages" tone={lowText.length ? "warn" : "good"} icon={<ScanLine className="h-3.5 w-3.5" />} />
        <KpiTile label="Missing documents" value={pkg.missing_references.length} sub={pkg.missing_references.length ? "referenced, not supplied" : "none detected"} tone={pkg.missing_references.length ? "bad" : "good"} icon={<FileQuestion className="h-3.5 w-3.5" />} />
      </div>

      {pkg.missing_references.length > 0 && (
        <Card title="Referenced but missing" icon={<AlertTriangle className="h-4 w-4 text-bad" />} subtitle="Answers that depend on these will show as 'points elsewhere' until you upload them.">
          <div className="grid gap-2 md:grid-cols-2">
            {pkg.missing_references.map((m, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-bad/25 bg-bad-soft/40 p-2.5">
                <div className="flex items-start gap-2">
                  <FileQuestion className="mt-0.5 h-4 w-4 shrink-0 text-bad-ink" />
                  <span className="flex-1 text-[13px] font-medium text-ink">{m.label}</span>
                  {m.page ? <PageLink page={m.page} onClick={() => openSource({ packageId: pkg.package_id, docId: m.doc_id, page: m.page, quote: m.quote, title: m.label })} /> : null}
                </div>
                {m.quote && <Quote text={m.quote} />}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Files" actions={actions}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-3 font-semibold">Doc</th><th className="py-1.5 pr-3 font-semibold">File</th><th className="py-1.5 pr-3 font-semibold">Tag</th>
                <th className="py-1.5 pr-3 font-semibold">SHA-256</th><th className="py-1.5 pr-3 text-right font-semibold">Pages</th><th className="py-1.5 text-right font-semibold">Visual</th>
              </tr>
            </thead>
            <tbody>
              {pkg.files.map((f) => (
                <tr key={f.doc_id} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3"><Chip size="xs">{f.doc_id}</Chip></td>
                  <td className="max-w-[360px] truncate py-1.5 pr-3 font-medium text-ink" title={f.path}>{f.filename}</td>
                  <td className="py-1.5 pr-3"><Chip tone="accent" size="xs">{TAG_LABEL[f.tag] ?? f.tag}</Chip></td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-ink-2">
                    <button className="inline-flex items-center gap-1 hover:text-ink" title={`${f.sha256} (click to copy)`} onClick={() => navigator.clipboard?.writeText(f.sha256)}>
                      {shortHash(f.sha256, 12)}<Copy className="h-3 w-3" />
                    </button>
                  </td>
                  <td className="py-1.5 pr-3 text-right tnum">{f.page_count}</td>
                  <td className="py-1.5 text-right tnum">{pages.filter((p) => p.doc_id === f.doc_id && p.needs_visual).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Text per page" subtitle="Characters in the text layer. Short bars are scans or image pages and are read visually."
        actions={pkg.files.length > 1 ? <Segmented value={doc} onChange={setDoc} options={pkg.files.map((f) => ({ value: f.doc_id, label: f.doc_id }))} /> : undefined}>
        {pages.length === 0 ? <div className="text-sm text-muted">Page details are not available yet.</div> : (
          <>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 4, right: 4, left: -12, bottom: 0 }} barCategoryGap={1}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="page" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={44} />
                  <Tooltip cursor={{ fill: "var(--accent-soft)" }} formatter={(v: number) => [num(v), "characters"]} labelFormatter={(l) => `Page ${l}`} />
                  <Bar dataKey="chars" radius={[2, 2, 0, 0]} isAnimationActive={false} onClick={(d: { page?: number }) => { const p = docPages.find((x) => x.page === d.page); if (p) open(p); }}>
                    {chart.map((c) => <Cell key={c.page} cursor="pointer" fill={c.low ? "var(--bad)" : c.visual ? "var(--violet)" : "var(--s1)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ink-2">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" />Text page</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet" />Needs visual pass</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-bad" />Low / no text</span>
              <span className="ml-auto text-muted">Median {num(median)} characters per page · click a bar to open the page</span>
            </div>
          </>
        )}
      </Card>

      <Card title="Pages needing a visual pass" icon={<Eye className="h-4 w-4 text-violet" />}>
        {byReason.length === 0 ? (
          <div className="flex items-center gap-2 text-[13px] text-good-ink"><CheckCircle2 className="h-4 w-4" /> Every page has a usable text layer.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {byReason.map(([reason, ps]) => (
              <Collapsible key={reason} defaultOpen={byReason.length <= 3}
                summary={<span className="flex items-center gap-2"><Chip tone="violet" size="xs" icon={reasonIcon(reason)}>{ps.length}</Chip>{reason}</span>}>
                <div className="flex flex-wrap gap-1.5">
                  {ps.map((p) => (
                    <button key={`${p.doc_id}-${p.page}`} onClick={() => open(p)} title={[...p.choice_fields, ...p.strike_hits.map((s) => `struck: ${s.word} in "${s.context}"`)].join("; ")}
                      className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs tnum hover:border-accent", p.strike_hits.length ? "border-bad/40 text-bad-ink" : "border-line text-ink-2")}>
                      {pkg.files.length > 1 && <span className="text-muted">{p.doc_id}:</span>}p.{p.page}
                      {p.strike_hits.length > 0 && <Strikethrough className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Inside a run (/runs/:id/package). */
export default function PackageCheck() {
  const { meta } = useRun();
  const pkg = useAsync(() => (meta ? api.package(meta.package_id) : Promise.resolve(undefined)), [meta?.package_id]);
  return (
    <>
      <PageHeader title="Package check" subtitle="What the tool received before reading: files, page text and gaps." />
      {!meta || pkg.loading ? <Spinner /> : pkg.error ? <ErrorBox error={pkg.error} /> : pkg.data ? <PackageView pkg={pkg.data} /> : <EmptyState title="No package" />}
    </>
  );
}

/** Before a run (/packages/:packageId), reached from New analysis. */
export function StandalonePackageCheck() {
  const { packageId = "" } = useParams();
  const nav = useNavigate();
  const { draft, bumpRuns } = useApp();
  const pkg = useAsync(() => api.package(packageId), [packageId]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const run = await api.startRun(packageId, draft.inputs);
      bumpRuns();
      nav(`/runs/${run.run_id}/progress`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Package check" subtitle={pkg.data ? `${pkg.data.contract_id} · ${pkg.data.title}` : packageId}
        actions={<>
          <Button onClick={() => nav("/new")}>Back to inputs</Button>
          <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={start} disabled={busy || !pkg.data}>{busy ? "Starting…" : "Start analysis"}</Button>
        </>} />
      {err ? <div className="mb-3"><ErrorBox error={err} title="Could not start" /></div> : null}
      {pkg.loading ? <Spinner /> : pkg.error ? <ErrorBox error={pkg.error} /> : <PackageView pkg={pkg.data!} />}
    </>
  );
}
