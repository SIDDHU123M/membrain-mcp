// The hosted ledger's front door (/login on membrain-cloud). Never rendered by
// a local server — locals have no lock, and this page says so if opened there.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type AuthConfig } from './api.js';
import logo from './assets/membrain-logo.png';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; theme?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>(window.location.hash === '#signup' ? 'up' : 'in');
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [selfHosted, setSelfHosted] = useState(false);
  const [error, setError] = useState<string | null>(
    new URLSearchParams(window.location.search).get('error'),
  );
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [tsReady, setTsReady] = useState(false);
  const tsRef = useRef<HTMLDivElement>(null);
  const tsWidget = useRef<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const dark = saved === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  useEffect(() => {
    api
      .authConfig()
      .then(setCfg)
      .catch(() => setSelfHosted(true));
  }, []);

  useEffect(() => {
    if (!cfg?.sitekey) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => setTsReady(true);
    document.head.appendChild(s);
    return () => s.remove();
  }, [cfg?.sitekey]);

  useEffect(() => {
    if (mode === 'up' && tsReady && cfg?.sitekey && tsRef.current && !tsWidget.current && window.turnstile) {
      tsWidget.current = window.turnstile.render(tsRef.current, {
        sitekey: cfg.sitekey,
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      });
    }
  }, [mode, tsReady, cfg?.sitekey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'up') {
        const token = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')?.value;
        await api.signup({ email, password, name: name.trim() || undefined, turnstile: token });
      } else {
        await api.login(email, password);
      }
      window.location.href = '/app';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
      window.turnstile?.reset(tsWidget.current ?? undefined);
      setBusy(false);
    }
  };

  const switchMode = (m: 'in' | 'up') => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <a href="/" className="mb-7 flex flex-col items-center text-center no-underline">
          <img
            src={logo}
            alt=""
            className="h-14 w-14 rounded border border-[var(--line-strong)] object-cover"
          />
          <h1 className="display mt-3 text-[30px] font-semibold leading-none text-[var(--text)]">
            Membrain
          </h1>
          <p className="label mt-2">The memory ledger</p>
        </a>

        <div className="card p-6">
          <div className="rule-double mb-5" aria-hidden="true" />

          {selfHosted ? (
            <div>
              <h2 className="display text-[18px] font-semibold">No lock on this door</h2>
              <p className="mt-2 text-[13px] leading-5 text-[var(--text-2)]">
                This is a self-hosted ledger — it has no accounts by design. Sign-in only exists on
                the hosted ledger at membrain.devlune.in.
              </p>
              <a className="btn mt-4 inline-block" href="/">
                Open the ledger
              </a>
            </div>
          ) : (
            <>
              <div className="mb-4 flex gap-1.5" role="tablist" aria-label="Sign in or create account">
                <button
                  role="tab"
                  aria-selected={mode === 'in'}
                  className={mode === 'in' ? 'btn-primary flex-1' : 'btn flex-1'}
                  onClick={() => switchMode('in')}
                >
                  Sign in
                </button>
                <button
                  role="tab"
                  aria-selected={mode === 'up'}
                  className={mode === 'up' ? 'btn-primary flex-1' : 'btn flex-1'}
                  onClick={() => switchMode('up')}
                >
                  Start a ledger
                </button>
              </div>

              <form onSubmit={(e) => void submit(e)}>
                {mode === 'up' && (
                  <div className="mb-3">
                    <label className="label mb-1 block" htmlFor="login-name">
                      Name
                    </label>
                    <input
                      id="login-name"
                      className="input w-full"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                )}
                <div className="mb-3">
                  <label className="label mb-1 block" htmlFor="login-email">
                    Email
                  </label>
                  <input
                    id="login-email"
                    className="input w-full"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="mb-3">
                  <label className="label mb-1 block" htmlFor="login-password">
                    Password
                  </label>
                  <input
                    id="login-password"
                    className="input w-full"
                    type="password"
                    required
                    minLength={8}
                    autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                {mode === 'up' && cfg?.sitekey && <div ref={tsRef} className="mb-3" />}

                {error && <p className="notice mb-3 text-[13px]">{error}</p>}

                <button className="btn-primary w-full" disabled={busy} type="submit">
                  {busy ? 'One moment…' : mode === 'up' ? 'Open a new ledger' : 'Open your ledger'}
                </button>
              </form>

              {(cfg?.github || cfg?.google) && (
                <>
                  <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-[var(--text-2)]">
                    <span className="h-px flex-1 bg-[var(--line)]" aria-hidden="true" />
                    or
                    <span className="h-px flex-1 bg-[var(--line)]" aria-hidden="true" />
                  </div>
                  <div className="grid gap-2">
                    {cfg?.github && (
                      <a className="btn text-center" href="/api/auth/github">
                        Continue with GitHub
                      </a>
                    )}
                    {cfg?.google && (
                      <a className="btn text-center" href="/api/auth/google">
                        Continue with Google
                      </a>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <p className="mt-5 text-center text-[12px] text-[var(--text-2)]">
          <a className="underline" href="/privacy">
            Privacy
          </a>{' '}
          ·{' '}
          <a className="underline" href="https://github.com/SIDDHU123M/membrain-mcp">
            Self-host instead
          </a>{' '}
          · Free, no telemetry
        </p>
      </div>
    </div>
  );
}
