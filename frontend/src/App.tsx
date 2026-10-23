import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { RunShell, Shell } from "./components/Layout";
import Home from "./pages/Home";
import NewAnalysis from "./pages/NewAnalysis";
import Report from "./pages/Report";
import AllAnswers from "./pages/AllAnswers";
import Accuracy from "./pages/Accuracy";
import Technical from "./pages/Technical";
import About from "./pages/About";
import TermDetail from "./pages/TermDetail";
import ProjectShell from "./pages/project/ProjectShell";
import ProjectOverview from "./pages/project/Overview";
import ProjectErrors from "./pages/project/Errors";
import ProjectCompare from "./pages/project/Compare";
import ProjectFair from "./pages/project/Fair";
import ProjectConsistency from "./pages/project/Consistency";
import ProjectChecks from "./pages/project/ManualCheck";
import { SAVED_ONLY_NOTE, STATIC_SITE } from "./staticSite";

/** The static copy cannot read new contracts. */
function SavedOnly() {
  return <p className="text-[15px] text-ink-2">{SAVED_ONLY_NOTE}</p>;
}

/** Old addresses (overview, clauses, review, flags, cash, progress, package, export) still land somewhere sensible. */
function OldRun({ to }: { to: "" | "answers" | "answers?filter=check" | "technical" }) {
  const { runId = "" } = useParams();
  return <Navigate to={`/runs/${runId}${to ? `/${to}` : ""}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="new" element={STATIC_SITE ? <SavedOnly /> : <NewAnalysis />} />
        <Route path="about" element={<About />} />
        {/* Project area: how the team tested the tool (kept apart from the contractor pages) */}
        <Route path="project" element={<ProjectShell />}>
          <Route index element={<ProjectOverview />} />
          <Route path="accuracy" element={<Accuracy />} />
          <Route path="errors" element={<ProjectErrors />} />
          <Route path="compare" element={<ProjectCompare />} />
          <Route path="fair" element={<ProjectFair />} />
          <Route path="consistency" element={<ProjectConsistency />} />
          <Route path="checks" element={<ProjectChecks />} />
          <Route path="*" element={<Navigate to="/project" replace />} />
        </Route>
        <Route path="accuracy" element={<Navigate to="/project/accuracy" replace />} />
        <Route path="evaluation" element={<Navigate to="/project/accuracy" replace />} />
      </Route>
      <Route path="runs/:runId" element={<RunShell />}>
        <Route index element={<Report />} />
        <Route path="answers" element={<AllAnswers />} />
        <Route path="technical" element={<Technical />} />
        <Route path="terms/:term" element={<TermDetail />} />
        <Route path="overview" element={<OldRun to="" />} />
        <Route path="flags" element={<OldRun to="" />} />
        <Route path="cash" element={<OldRun to="" />} />
        <Route path="clauses" element={<OldRun to="answers" />} />
        <Route path="review" element={<OldRun to="answers?filter=check" />} />
        <Route path="progress" element={<OldRun to="technical" />} />
        <Route path="package" element={<OldRun to="technical" />} />
        <Route path="export" element={<OldRun to="technical" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
