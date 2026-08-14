// Privacy policy for the hosted ledger (membrain.devlune.in). Pre-auth route.
import { useEffect } from 'react';
import logo from './assets/membrain-logo.png';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-7">
    <h2 className="display text-[18px] font-semibold">{title}</h2>
    <div className="mt-2 space-y-2 text-[14px] leading-6 text-[var(--text-2)]">{children}</div>
  </section>
);

export default function Privacy() {
  useEffect(() => {
    const dark = localStorage.getItem('theme') === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-10">
      <a href="/" className="flex items-center gap-3 no-underline">
        <img src={logo} alt="" className="h-10 w-10 rounded border border-[var(--line-strong)] object-cover" />
        <div>
          <span className="display text-[20px] font-semibold text-[var(--text)]">Membrain</span>
          <span className="label block">The memory ledger</span>
        </div>
      </a>

      <h1 className="display mt-8 text-[28px] font-semibold">Privacy, in plain words</h1>
      <p className="label mt-2">Hosted ledger · membrain.devlune.in · last updated 14 Aug 2026</p>
      <div className="rule-double mt-4" aria-hidden="true" />

      <p className="mt-5 text-[14px] leading-6 text-[var(--text-2)]">
        Membrain exists so you and your AI agents can keep one honest memory. A memory product
        that plays games with your data would be pointless — so this page is short and literal.
        (The self-hosted version never talks to us at all; this policy covers only the hosted
        ledger.)
      </p>

      <Section title="What we store">
        <p>
          Your account (email, display name, and — if you sign in with GitHub or Google — the id
          those services give us), your memories and settings, and the names of the API keys you
          create. Keys themselves are stored only as hashes. That's the whole list.
        </p>
      </Section>

      <Section title="Where it lives">
        <p>
          On Cloudflare's infrastructure (D1 database and Vectorize index), encrypted at rest and
          in transit. This is <strong>not</strong> zero-knowledge hosting: the operator could
          technically access stored data, and we won't pretend otherwise. We simply don't, outside
          of debugging you've asked for. If you need stronger guarantees, self-host — that's why
          the open-source version exists.
        </p>
      </Section>

      <Section title="AI processing">
        <p>
          Summaries, topic maps, and titles run on Cloudflare Workers AI (or an LLM endpoint you
          configure yourself in Settings). Entries you <em>seal</em> are excluded from every AI
          operation and from agent access — enforced in queries, not in good intentions.
        </p>
      </Section>

      <Section title="Who can read your ledger">
        <p>
          You, signed in — and any agent holding an API key you created. Revoke a key and that
          access ends. Nobody else: there is no sharing, no public profiles, no cross-user anything.
        </p>
      </Section>

      <Section title="What we never do">
        <p>
          No analytics scripts, no trackers, no ads, no selling or sharing data with third parties,
          no training AI models on your memories. One cookie exists: your session. That's it.
        </p>
      </Section>

      <Section title="Your data, your exit">
        <p>
          Export everything as JSON from Settings at any time — it imports straight into a
          self-hosted ledger. Delete entries whenever you like; deletion is real, not a soft flag.
          To delete your whole account, email{' '}
          <a className="underline" href="mailto:sidharth@devlune.in">
            sidharth@devlune.in
          </a>{' '}
          and everything is wiped.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes, the new version appears here with a new date. No silent edits.
        </p>
      </Section>

      <p className="mt-10 text-[13px] text-[var(--text-2)]">
        <a className="underline" href="/login">
          Back to sign in
        </a>{' '}
        ·{' '}
        <a className="underline" href="https://github.com/SIDDHU123M/membrain-mcp">
          Source on GitHub
        </a>
      </p>
    </div>
  );
}
