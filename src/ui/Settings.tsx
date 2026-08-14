import { useEffect, useState } from 'react';
import { api } from './api.js';
import PageTabs from './Tabs.js';

function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
  mono,
  secret,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  mono?: boolean;
  secret?: boolean;
}) {
  return (
    <div>
      <label className="label mb-1.5">{label}</label>
      <input
        className={`input ${mono ? 'mono text-[12.5px]' : ''}`}
        type={secret ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="mt-1 text-[11px] leading-4 text-[var(--text-3)]">{hint}</p>}
    </div>
  );
}

/* Cloud presets — all but Anthropic speak the OpenAI chat-completions shape. */
const PRESETS: Record<string, { provider: string; url: string; modelHint: string }> = {
  ollama: { provider: 'ollama', url: '', modelHint: '' },
  openai: { provider: 'openai', url: 'https://api.openai.com/v1', modelHint: 'gpt-4o-mini' },
  anthropic: { provider: 'anthropic', url: 'https://api.anthropic.com', modelHint: 'claude-sonnet-5' },
  openrouter: {
    provider: 'openai',
    url: 'https://openrouter.ai/api/v1',
    modelHint: 'qwen/qwen3-30b-a3b',
  },
  nvidia: {
    provider: 'openai',
    url: 'https://integrate.api.nvidia.com/v1',
    modelHint: 'nvidia/llama-3.3-nemotron-super-49b-v1',
  },
  custom: { provider: 'openai', url: '', modelHint: 'model id at your endpoint' },
};

function presetOf(provider: string, url: string): string {
  if (!provider || provider === 'ollama') return 'ollama';
  if (provider === 'anthropic') return 'anthropic';
  for (const [k, p] of Object.entries(PRESETS)) {
    if (k !== 'custom' && p.provider === provider && p.url === url) return k;
  }
  return 'custom';
}

const LOCAL_TABS = [
  { key: 'brain', label: 'The clerk', icon: 'quill' },
  { key: 'embeddings', label: 'Embeddings', icon: 'vector' },
  { key: 'paths', label: 'Paths', icon: 'folder' },
  { key: 'data', label: 'Backup & data', icon: 'archive' },
];
const CLOUD_TABS = [
  { key: 'brain', label: 'The clerk', icon: 'quill' },
  { key: 'data', label: 'Your data', icon: 'archive' },
];

export default function Settings({ cloud = false }: { cloud?: boolean }) {
  const [sec, setSec] = useState('brain');
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.settings().then((s) => {
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(s)) v[k] = val ?? '';
      setValues(v);
    });
  }, []);

  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty((d) => ({ ...d, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await api.saveSettings(dirty);
      setDirty({});
      setNotice('Saved. Embedding changes apply on next restart; everything else is immediate.');
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importJson = async (file: File | undefined, kind: 'memories' | 'skills') => {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = JSON.parse(await file.text()) as unknown;
      const r =
        kind === 'memories'
          ? await api.importMemoriesJson(data)
          : await api.importSkillsJson(data);
      setNotice(`Restored ${r.imported} ${kind} from ${file.name}.`);
    } catch (e) {
      setNotice(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const [llmTest, setLlmTest] = useState<string | null>(null);
  const testBrain = async () => {
    setBusy(true);
    try {
      // unsaved edits are saved first — testing what's on screen, not what was
      if (Object.keys(dirty).length > 0) {
        setLlmTest('Saving…');
        await api.saveSettings(dirty);
        setDirty({});
      }
      setLlmTest('Testing…');
      const r = await api.testLlm();
      setLlmTest(`✓ ${r.provider} answered with ${r.model}`);
    } catch (e) {
      setLlmTest(`✕ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const provider = values.embedding_provider || 'local';

  return (
    <div className="mx-auto w-full max-w-xl space-y-3.5">
      <PageTabs tabs={cloud ? CLOUD_TABS : LOCAL_TABS} active={sec} onSelect={setSec} />
      <section className={`card space-y-3.5 p-4 sm:p-5 ${sec === 'brain' ? '' : 'hidden'}`}>
        <div>
          <span className="label">Sec. 01 — The clerk's brain</span>
          <p className="display mt-1 text-[13px] italic leading-5 text-[var(--text-2)]">
            {cloud
              ? 'The AI behind organizing, titles, summaries, and import distillation. The hosted ledger runs it on Workers AI — or point it at any provider with your own key.'
              : 'The AI behind organizing, titles, summaries, and import distillation. Local Ollama by default; no local GPU? Point it at a cloud provider — just paste an API key.'}
          </p>
        </div>
        <div>
          <label className="label mb-1.5">Provider</label>
          <select
            className="input"
            value={presetOf(values.llm_provider ?? 'ollama', values.llm_api_url ?? '')}
            onChange={(e) => {
              const p = PRESETS[e.target.value];
              set('llm_provider', p.provider);
              set('llm_api_url', p.url);
            }}
          >
            <option value="ollama">
              {cloud ? 'Workers AI — built in, free (default)' : 'Local Ollama — private, offline (default)'}
            </option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic — Claude</option>
            <option value="openrouter">OpenRouter — hundreds of models, one key</option>
            <option value="nvidia">NVIDIA NIM</option>
            <option value="custom">Custom — any OpenAI-compatible endpoint</option>
          </select>
        </div>
        {(values.llm_provider ?? 'ollama') === 'ollama' ? (
          cloud ? null : (
          <>
            <Field
              label="Ollama URL"
              value={values.ollama_url ?? ''}
              placeholder="http://127.0.0.1:11434"
              onChange={(v) => set('ollama_url', v)}
              mono
            />
            <Field
              label="Ollama model"
              value={values.ollama_model ?? ''}
              placeholder="first installed model"
              onChange={(v) => set('ollama_model', v)}
              mono
            />
          </>
          )
        ) : (
          <>
            <Field
              label="Base URL"
              value={values.llm_api_url ?? ''}
              placeholder="https://api.example.com/v1"
              onChange={(v) => set('llm_api_url', v)}
              mono
            />
            <Field
              label="API key"
              hint="Stored in plain text in memory.db — same trust boundary as everything else. Sent only to the base URL above."
              value={values.llm_api_key ?? ''}
              onChange={(v) => set('llm_api_key', v)}
              mono
              secret
            />
            <Field
              label="Model"
              value={values.llm_model ?? ''}
              placeholder={
                PRESETS[presetOf(values.llm_provider ?? 'ollama', values.llm_api_url ?? '')]
                  ?.modelHint ?? 'model id'
              }
              onChange={(v) => set('llm_model', v)}
              mono
            />
          </>
        )}
        <div>
          <label className="label mb-1.5">Use LLM on import</label>
          <select
            className="input"
            value={values.import_llm === 'off' ? 'off' : 'on'}
            onChange={(e) => set('import_llm', e.target.value)}
          >
            <option value="on">On — distill documents into key points</option>
            <option value="off">Off — always import raw text</option>
          </select>
        </div>
        <div>
          <label className="label mb-1.5">Agent writes over MCP</label>
          <select
            className="input"
            value={values.mcp_writes === 'staged' ? 'staged' : 'direct'}
            onChange={(e) => set('mcp_writes', e.target.value)}
          >
            <option value="direct">Direct — agents save straight to the ledger (recommended)</option>
            <option value="staged">Staged — agent saves wait in the review queue for your approval</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn"
            disabled={busy}
            title="Saves any pending changes, then sends a tiny prompt to the configured brain"
            onClick={() => void testBrain()}
          >
            Test connection
          </button>
          {llmTest && <span className="text-[12px] notice">{llmTest}</span>}
        </div>
      </section>

      <section className={`card space-y-3.5 p-4 sm:p-5 ${sec === 'embeddings' && !cloud ? '' : 'hidden'}`}>
        <div>
          <span className="label">Sec. 02 — Embeddings</span>
          <p className="display mt-1 text-[13px] italic leading-5 text-[var(--text-2)]">
            Local runs fully offline. Switching model re-embeds every memory on next restart.
          </p>
        </div>
        <div>
          <label className="label mb-1.5">Provider</label>
          <select
            className="input"
            value={provider}
            onChange={(e) => set('embedding_provider', e.target.value)}
          >
            <option value="local">Local — fastembed, all-MiniLM (default)</option>
            <option value="api">API — OpenAI-compatible endpoint</option>
          </select>
        </div>
        {provider === 'api' && (
          <>
            <Field
              label="API URL"
              value={values.embedding_api_url ?? ''}
              placeholder="https://api.example.com/v1"
              onChange={(v) => set('embedding_api_url', v)}
              mono
            />
            <Field
              label="Model"
              value={values.embedding_api_model ?? ''}
              placeholder="text-embedding-3-small"
              onChange={(v) => set('embedding_api_model', v)}
              mono
            />
            <Field
              label="API key"
              hint="Stored in plain text in memory.db — same trust boundary as everything else."
              value={values.embedding_api_key ?? ''}
              onChange={(v) => set('embedding_api_key', v)}
              mono
            />
          </>
        )}
      </section>

      <section className={`card space-y-3.5 p-4 sm:p-5 ${sec === 'paths' && !cloud ? '' : 'hidden'}`}>
        <div>
          <span className="label">Sec. 03 — Paths</span>
          <p className="display mt-1 text-[13px] italic leading-5 text-[var(--text-2)]">
            Where membrain looks for skills and pre-existing agent memory.
          </p>
        </div>
        <Field
          label="Skill roots (JSON object, name → absolute path)"
          value={values.skill_roots ?? ''}
          placeholder='{"claude": "~/.claude/skills", "agents": "~/.agents/skills"}'
          onChange={(v) => set('skill_roots', v)}
          mono
        />
        <Field
          label="Extra agent memory dirs (JSON array of absolute paths)"
          value={values.agent_memory_dirs ?? ''}
          placeholder="[]"
          onChange={(v) => set('agent_memory_dirs', v)}
          mono
        />
      </section>

      <section className={`card space-y-3.5 p-4 sm:p-5 ${sec === 'data' ? '' : 'hidden'}`}>
        <div>
          <span className="label">{cloud ? 'Sec. 02 — Your data' : 'Sec. 04 — Backup and data'}</span>
          <p className="display mt-1 text-[13px] italic leading-5 text-[var(--text-2)]">
            {cloud
              ? 'Your ledger exports as portable JSON — it imports straight into a self-hosted membrain, and back here.'
              : 'The whole store is one SQLite file — a snapshot is a complete backup. JSON exports are portable and re-importable (drop them on the Memories tab too).'}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {!cloud && (
            <button className="btn-primary w-full justify-center" onClick={() => window.open('/api/backup', '_blank')}>
              Download DB snapshot
            </button>
          )}
          <button className="btn w-full justify-center" onClick={() => window.open('/api/export/memories', '_blank')}>
            Export memories JSON
          </button>
          {!cloud && (
            <button className="btn w-full justify-center" onClick={() => window.open('/api/export/skills', '_blank')}>
              Export skills JSON
            </button>
          )}
          <label className="btn w-full cursor-pointer justify-center">
            Import memories JSON
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => void importJson(e.target.files?.[0], 'memories')}
            />
          </label>
          {!cloud && (
            <label className="btn w-full cursor-pointer justify-center">
              Import skills JSON
              <input
                type="file"
                accept=".json"
                hidden
                onChange={(e) => void importJson(e.target.files?.[0], 'skills')}
              />
            </label>
          )}
          <div className={cloud ? 'hidden' : 'sm:col-span-2'}>
            <label className="label mb-1.5">Check for updates</label>
            <select
              className="input"
              value={values.update_check === 'off' ? 'off' : 'on'}
              onChange={(e) => set('update_check', e.target.value)}
            >
              <option value="on">On — ask npm for the latest version (sends only the package name)</option>
              <option value="off">Off — never call out; you check versions yourself</option>
            </select>
          </div>
          <button
            className={`btn w-full justify-center sm:col-span-2 ${cloud ? 'hidden' : ''}`}
            onClick={() => {
              setNotice(null);
              void fetch('/api/export/markdown', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
              })
                .then((r) => r.json() as Promise<{ dir: string; files: number }>)
                .then((r) => setNotice(`Wrote ${r.files} markdown files to ${r.dir}`))
                .catch((e: Error) => setNotice(e.message));
            }}
          >
            Export as Markdown folder (one file per entry, git-friendly)
          </button>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={save}
          disabled={busy || Object.keys(dirty).length === 0}
        >
          Save settings
        </button>
        {notice && <span className="text-[12px] notice">{notice}</span>}
      </div>
    </div>
  );
}
