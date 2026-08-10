import { useEffect, useState } from 'react';
import { api } from './api.js';

function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
  mono,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="label mb-1.5">{label}</label>
      <input
        className={`input ${mono ? 'mono text-[12.5px]' : ''}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="mt-1 text-[11px] leading-4 text-[var(--text-3)]">{hint}</p>}
    </div>
  );
}

export default function Settings() {
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

  const provider = values.embedding_provider || 'local';

  return (
    <div className="mx-auto w-full max-w-xl space-y-3.5">
      <section className="card space-y-3.5 p-4 sm:p-5">
        <div>
          <span className="label">Sec. 01 — Import LLM</span>
          <p className="display mt-1 text-[13px] italic leading-5 text-[var(--text-2)]">
            Documents you import are distilled into individual memories by a local Ollama. If it's
            unreachable, the raw text is saved instead — import always works.
          </p>
        </div>
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
      </section>

      <section className="card space-y-3.5 p-4 sm:p-5">
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

      <section className="card space-y-3.5 p-4 sm:p-5">
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

      <section className="card space-y-3.5 p-4 sm:p-5">
        <div>
          <span className="label">Sec. 04 — Backup and data</span>
          <p className="display mt-1 text-[13px] italic leading-5 text-[var(--text-2)]">
            The whole store is one SQLite file — a snapshot is a complete backup. JSON exports are
            portable and re-importable (drop them on the Memories tab too).
          </p>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <button className="btn-primary w-full justify-center" onClick={() => window.open('/api/backup', '_blank')}>
            Download DB snapshot
          </button>
          <button className="btn w-full justify-center" onClick={() => window.open('/api/export/memories', '_blank')}>
            Export memories JSON
          </button>
          <button className="btn w-full justify-center" onClick={() => window.open('/api/export/skills', '_blank')}>
            Export skills JSON
          </button>
          <label className="btn w-full cursor-pointer justify-center">
            Import memories JSON
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => void importJson(e.target.files?.[0], 'memories')}
            />
          </label>
          <label className="btn w-full cursor-pointer justify-center">
            Import skills JSON
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => void importJson(e.target.files?.[0], 'skills')}
            />
          </label>
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
