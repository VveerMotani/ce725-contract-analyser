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
        <Route path="new" element={<NewAnalysis />} />
        <Route path="accuracy" element={<Accuracy />} />
        <Route path="about" element={<About />} />
        <Route path="evaluation" element={<Navigate to="/accuracy" replace />} />
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
