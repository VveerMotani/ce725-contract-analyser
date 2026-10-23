import type { ReactNode } from "react";
import { FlaskRound } from "lucide-react";
import { Chip } from "./ui";

/** Answer-key replay runs: the golden answers stand in for the AI. They must never pass for AI output. */
export const REPLAY_LABEL = "Answer-key replay (not AI output)";

export function ReplayChip({ size = "xs" }: { size?: "xs" | "sm" }) {
  return (
    <Chip tone="violet" size={size} icon={<FlaskRound className="h-3 w-3" />}
      title="The golden answer key stands in for the AI in this run. It tests the pipeline (verification, flags, cash model), not the AI.">
      {REPLAY_LABEL}
    </Chip>
  );
}

export function ReplayBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border-2 border-violet/50 bg-violet-soft p-3.5 text-violet-ink">
      <FlaskRound className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="text-[13px]">
        <div className="text-[14px] font-semibold">{REPLAY_LABEL}</div>
        {children ?? <>The answers in this run are the golden answer key replayed through the pipeline. Verification, flags and the cash model are real; the answers are <b>not</b> what the AI read. Run the AI on this contract for real results.</>}
      </div>
    </div>
  );
}
