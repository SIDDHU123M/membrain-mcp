/** The clerk at work — the one generating visual for every AI operation:
 *  pulsing seal, bold shimmering label, ink lines writing themselves, and an
 *  optional progress rule with counts. */
export default function ClerkWorking({
  label,
  progress,
}: {
  label: string;
  progress?: { done: number; total: number };
}) {
  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;
  return (
    <div className="card mt-2.5 px-4 py-3.5" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
          <span className="relative h-2 w-2 rounded-full bg-[var(--accent)]" />
        </span>
        <span className="display gen-shimmer min-w-0 break-words text-[14.5px] font-semibold italic">
          {label}
        </span>
        {pct !== null && (
          <span className="mono ml-auto shrink-0 text-[11px] text-[var(--text-3)]">
            {progress!.done}/{progress!.total} · {pct}%
          </span>
        )}
      </div>
      {pct !== null && (
        <div className="mt-2.5 h-[3px] w-full bg-[var(--line)]">
          <div
            className="h-full bg-[var(--accent)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="mt-3 space-y-2" aria-hidden="true">
        <div className="gen-bar w-3/4" />
        <div className="gen-bar w-1/2" style={{ animationDelay: '0.4s' }} />
        <div className="gen-bar w-2/3" style={{ animationDelay: '0.8s' }} />
      </div>
    </div>
  );
}
