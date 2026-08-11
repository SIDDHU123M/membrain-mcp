import { useEffect, useRef, useState } from 'react';

export interface PaletteAction {
  label: string;
  hint?: string;
  run: () => void;
}

/** Ctrl+K command palette — jump anywhere in the ledger without touching the mouse. */
export default function Palette({
  actions,
  onClose,
}: {
  actions: PaletteAction[];
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const list = actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setSel(0), [q]);

  const run = (a?: PaletteAction) => {
    if (!a) return;
    onClose();
    a.run();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="absolute inset-0"
        style={{ background: 'color-mix(in srgb, var(--bg) 55%, transparent)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="card relative z-10 w-full max-w-[26rem] overflow-hidden">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, list.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            }
            if (e.key === 'Enter') run(list[sel]);
          }}
          placeholder="Where to?"
          className="w-full border-b border-[var(--line)] bg-transparent px-4 py-3 text-[14px] outline-none"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {list.map((a, j) => (
            <li key={a.label}>
              <button
                role="option"
                aria-selected={j === sel}
                onMouseEnter={() => setSel(j)}
                onClick={() => run(a)}
                className="flex w-full items-baseline gap-3 px-4 py-2 text-left text-[13.5px]"
                style={
                  j === sel
                    ? { background: 'color-mix(in srgb, var(--accent) 10%, transparent)' }
                    : undefined
                }
              >
                <span>{a.label}</span>
                {a.hint && <span className="label ml-auto">{a.hint}</span>}
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="px-4 py-3 text-[13px] text-[var(--text-2)]">Nothing filed under that.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
