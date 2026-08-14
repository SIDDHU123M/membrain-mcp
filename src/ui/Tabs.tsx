// In-page section tabs — index cards within a page. Inline stroke icons keep
// the bundle dependency-free; ledger style, currentColor only.

const ICON_PATHS: Record<string, React.ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M10.5 12.5 21 2M15 8l3 3" />
    </>
  ),
  plug: (
    <>
      <path d="M9 7V3M15 7V3" />
      <path d="M6 7h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <rect x="3" y="14" width="18" height="6" rx="1" />
      <path d="M7 7h.01M7 17h.01" />
    </>
  ),
  quill: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  vector: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="8" r="2" />
      <circle cx="10" cy="18" r="2" />
      <path d="M7.8 7.2 16 8M7 7.8l2.4 8.2M16.6 9.8l-5.2 6.6" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  archive: (
    <>
      <rect x="3" y="3" width="18" height="5" rx="1" />
      <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
};

export function TabIcon({ name }: { name: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export interface PageTab {
  key: string;
  label: string;
  icon: string;
}

export default function PageTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: PageTab[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          className={active === t.key ? 'btn-primary' : 'btn'}
          onClick={() => onSelect(t.key)}
        >
          <TabIcon name={t.icon} />
          {t.label}
        </button>
      ))}
    </div>
  );
}
