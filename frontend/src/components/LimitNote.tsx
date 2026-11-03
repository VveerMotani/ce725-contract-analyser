// Daily reading limit on the hosted copy (GET /limits): a hook and the quiet lines shown by the upload button and form.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Limits } from "../types";
import { cx } from "./ui";

let last: Limits | undefined;

/** Current limits (fetched on mount; undefined until the first answer). `refresh` re-reads them, e.g. after a start. */
export function useLimits(): { limits: Limits | undefined; refresh: () => void } {
  const [limits, setLimits] = useState<Limits | undefined>(last);
  const refresh = useCallback(() => {
    api.limits().then((l) => { last = l; setLimits(l); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { limits, refresh };
}

/** True when the daily limit is set and used up. */
export const limitReached = (l: Limits | undefined) => !!l && l.daily_limit > 0 && l.remaining === 0;

/** "3 contracts a day — each reading uses paid AI credit. 2 left today." plus timing and page limit. Nothing when unlimited and local. */
export function LimitNote({ limits: l, className }: { limits: Limits | undefined; className?: string }) {
  if (!l || (l.daily_limit <= 0 && !l.hosted)) return null;
  const n = l.daily_limit;
  const left = l.remaining ?? Math.max(0, n - l.used_today);
  return (
    <div className={cx("flex flex-col gap-0.5 text-[13.5px] text-muted", className)}>
      {n > 0 && (left <= 0
        ? <span className="text-ink">Today’s {n} readings are used. Try again tomorrow.</span>
        : <span>{n} contracts a day — each reading uses paid AI credit. <span className="text-ink tnum">{left} left today.</span></span>)}
      <span>
        Reading takes about 5–15 minutes. Results stay until the server restarts.
        {l.max_pages > 0 && <> · Up to {l.max_pages} pages per contract</>}
      </span>
    </div>
  );
}
