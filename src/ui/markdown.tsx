import type { ReactNode } from 'react';

/* Minimal markdown renderer for SKILL.md preview — headings, lists, code,
   bold/italic/inline-code, links, frontmatter. React elements only, no HTML
   injection. ponytail: swap for a real md lib only if skills outgrow this. */

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = key;
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[([^\]]+)\]\(([^)]+)\))/;
  while (rest.length > 0) {
    const m = rest.match(pattern);
    if (!m || m.index === undefined) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        <code key={k++} className="pill">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={k++} className="font-semibold text-[var(--text)]">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith('[')) {
      out.push(
        <a
          key={k++}
          href={m[6]}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent-text)] underline decoration-[var(--accent-line)] underline-offset-2"
        >
          {m[5]}
        </a>,
      );
    } else {
      out.push(
        <em key={k++} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let lines = text.split(/\r?\n/);
  let k = 0;

  // frontmatter → dim mono meta block
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      blocks.push(
        <div key={k++} className="mono mb-4 rounded-lg border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-[11.5px] leading-5 text-[var(--text-3)]">
          {lines.slice(1, end).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>,
      );
      lines = lines.slice(end + 1);
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const end = lines.findIndex((l, j) => j > i && l.startsWith('```'));
      const body = lines.slice(i + 1, end === -1 ? undefined : end).join('\n');
      blocks.push(
        <pre key={k++} className="mono my-3 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--inset)] p-3 text-[12px] leading-relaxed text-[var(--text-2)]">
          {body}
        </pre>,
      );
      i = end === -1 ? lines.length : end + 1;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1
          ? 'display mt-5 mb-2 text-[19px] font-semibold'
          : level === 2
            ? 'display mt-5 mb-1.5 text-[15px] font-semibold'
            : 'mt-4 mb-1 text-[13px] font-semibold text-[var(--text-2)]';
      blocks.push(
        <div key={k++} className={cls} role="heading" aria-level={level}>
          {inline(h[2])}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={k++} className="my-2 space-y-1 pl-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2 text-[13.5px] leading-6 text-[var(--text-2)]">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              <span>{inline(it)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|[\s\-:|]+\|\s*$/.test(lines[i])) {
          rows.push(
            lines[i]
              .trim()
              .replace(/^\||\|$/g, '')
              .split('|')
              .map((c) => c.trim()),
          );
        }
        i++;
      }
      if (rows.length > 0) {
        blocks.push(
          <div key={k++} className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {rows[0].map((c, j) => (
                    <th key={j} className="label border-b-2 border-[var(--text)] px-2.5 py-1.5 text-left">
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, j) => (
                      <td key={j} className="border-b border-[var(--line)] px-2.5 py-1.5 align-top text-[var(--text-2)]">
                        {inline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|```|\s*[-*]\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k++} className="my-2 text-[13.5px] leading-6 text-[var(--text-2)]">
        {inline(para.join(' '))}
      </p>,
    );
  }
  return <div>{blocks}</div>;
}
