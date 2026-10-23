import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./api";
import { RunShell, Shell, lastRun } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useRun } from "./context";
import NewAnalysis from "./pages/NewAnalysis";
import PackageCheck, { StandalonePackageCheck } from "./pages/PackageCheck";
import RunProgress from "./pages/RunProgress";
import Overview from "./pages/Overview";
import ClauseTable from "./pages/ClauseTable";
import ReviewQueue from "./pages/ReviewQueue";
import RiskFlags from "./pages/RiskFlags";
import CashFlow from "./pages/CashFlow";
import Evaluation from "./pages/Evaluation";
import { About, ExportPage } from "./pages/ExportAbout";

/** "/" goes to the last opened run, else the most recent finished run, else New analysis. */
function Home() {
  const nav = useNavigate();
  const [msg] = useState("Finding your latest run…");
  useEffect(() => {
    let alive = true;
    api.runs().then((runs) => {
      if (!alive) return;
      const last = lastRun();
      const pick = runs.find((r) => r.run_id === last) ?? runs.find((r) => r.stage === "done") ?? runs[0];
      nav(pick ? `/runs/${pick.run_id}` : "/new", { replace: true });
    }).catch(() => alive && nav("/new", { replace: true }));
    return () => { alive = false; };
  }, [nav]);
  return <Spinner label={msg} />;
}

/** /runs/:id lands on Overview when finished, otherwise on Run progress. */
function RunIndex() {
  const { meta, metaError } = useRun();
  if (metaError && !meta) return <Navigate to="progress" replace />;
  if (!meta) return <Spinner />;
  return <Navigate to={meta.stage === "done" ? "overview" : "progress"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="new" element={<NewAnalysis />} />
        <Route path="packages/:packageId" element={<StandalonePackageCheck />} />
        <Route path="evaluation" element={<Evaluation />} />
        <Route path="about" element={<About />} />
      </Route>
      <Route path="runs/:runId" element={<RunShell />}>
        <Route index element={<RunIndex />} />
        <Route path="overview" element={<Overview />} />
        <Route path="package" element={<PackageCheck />} />
        <Route path="progress" element={<RunProgress />} />
        <Route path="clauses" element={<ClauseTable />} />
        <Route path="review" element={<ReviewQueue />} />
        <Route path="flags" element={<RiskFlags />} />
        <Route path="cash" element={<CashFlow />} />
        <Route path="export" element={<ExportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
