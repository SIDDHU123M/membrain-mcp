export interface Memory {
  id: number;
  content: string;
  title: string | null;
  tags: string[];
  source: string;
  created_at: string;
  updated_at: string;
  score?: number;
}

export interface Stats {
  memories: number;
  chunks: number;
  dbSizeBytes: number;
  embeddingModel: string | null;
}

export interface SkillInfo {
  root: string;
  name: string;
  description: string;
}

export interface Skill extends SkillInfo {
  content: string;
  path: string;
}

export interface MapCategory {
  name: string;
  description: string;
  ids: number[];
}

export interface MemoryMap {
  builtAt: string;
  model: string;
  hash: string;
  stale: boolean;
  categories: MapCategory[];
}

export interface Proposal {
  id: string;
  memoryId: number;
  kind: 'title';
  old: string | null;
  next: string;
  model: string;
  createdAt: string;
}

export type NodeKind = 'person' | 'project' | 'tool' | 'preference' | 'topic' | 'fact';

export interface MindMapNode {
  id: string;
  label: string;
  kind: NodeKind;
  memoryIds: number[];
}

export interface MindMapEdge {
  from: string;
  to: string;
  label: string;
}

export interface MindMap {
  builtAt: string;
  model: string;
  hash: string;
  stale: boolean;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

export interface AgentMemoryFile {
  path: string;
  agent: string;
  project: string | null;
  name: string;
  description: string;
  status: 'new' | 'imported' | 'changed';
  importedAt: string | null;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body instanceof FormData ? undefined : { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  memories: (q?: { query?: string; tag?: string }) => {
    const p = new URLSearchParams();
    if (q?.query) p.set('query', q.query);
    if (q?.tag) p.set('tag', q.tag);
    p.set('limit', '100');
    return req<Memory[]>(`/api/memories?${p}`);
  },
  addMemory: (content: string, tags: string[]) =>
    req<Memory>('/api/memories', { method: 'POST', body: JSON.stringify({ content, tags }) }),
  updateMemory: (id: number, patch: { content?: string; tags?: string[] }) =>
    req<Memory>(`/api/memories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteMemory: (id: number) => req<{ ok: true }>(`/api/memories/${id}`, { method: 'DELETE' }),
  importFile: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ memories: Memory[]; usedLlm: boolean }>('/api/import', {
      method: 'POST',
      body: fd,
    });
  },
  previewImport: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{
      filename: string;
      usedLlm: boolean;
      model: string | null;
      tags: string[];
      facts: string[];
    }>('/api/import/preview', { method: 'POST', body: fd });
  },
  commitImport: (facts: { content: string; tags?: string[] }[]) =>
    req<{ imported: number; memories: Memory[] }>('/api/import/commit', {
      method: 'POST',
      body: JSON.stringify({ facts }),
    }),
  stats: () => req<Stats>('/api/stats'),
  skills: () => req<SkillInfo[]>('/api/skills'),
  skill: (root: string, name: string) => req<Skill>(`/api/skills/${root}/${name}`),
  saveSkill: (root: string, name: string, content: string) =>
    req<Skill>(`/api/skills/${root}/${name}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  deleteSkill: (root: string, name: string) =>
    req<{ ok: true }>(`/api/skills/${root}/${name}`, { method: 'DELETE' }),
  generateTitles: () =>
    req<{ proposed: number }>('/api/insights/titles', { method: 'POST', body: '{}' }),
  proposeTitleFor: (id: number) =>
    req<{ proposed: number }>('/api/insights/titles', {
      method: 'POST',
      body: JSON.stringify({ ids: [id] }),
    }),
  proposals: () => req<Proposal[]>('/api/proposals'),
  resolveProposals: (ids: string[], accept: boolean) =>
    req<{ resolved: number; applied: number }>('/api/proposals/resolve', {
      method: 'POST',
      body: JSON.stringify({ ids, accept }),
    }),
  importMemoriesJson: (data: unknown) =>
    req<{ imported: number }>('/api/import/memories', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  importSkillsJson: (data: unknown) =>
    req<{ imported: number }>('/api/import/skills', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  duplicates: () =>
    req<{ pairs: { a: Memory; b: Memory; similarity: number }[] }>('/api/insights/duplicates'),
  mindMap: () => req<{ map: MindMap | null }>('/api/insights/mindmap'),
  buildMindMap: () => req<MindMap>('/api/insights/mindmap', { method: 'POST', body: '{}' }),
  memory: (id: number) => req<Memory>(`/api/memories/${id}`),
  map: () => req<{ map: MemoryMap | null }>('/api/insights/map'),
  buildMap: () => req<MemoryMap>('/api/insights/map', { method: 'POST', body: '{}' }),
  summarize: (ids?: number[]) =>
    req<{ summary: string }>('/api/insights/summary', {
      method: 'POST',
      body: JSON.stringify({ ids: ids ?? [] }),
    }),
  testLlm: () =>
    req<{ ok: boolean; provider: string; model: string }>('/api/llm/test', {
      method: 'POST',
      body: '{}',
    }),
  settings: () => req<Record<string, string | null>>('/api/settings'),
  saveSettings: (patch: Record<string, string>) =>
    req<Record<string, string | null>>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  agentMemory: () => req<AgentMemoryFile[]>('/api/agent-memory'),
  importAgentMemory: (paths: string[]) =>
    req<{ imported: number; added: number; updated: number; skipped: number }>(
      '/api/agent-memory/import',
      { method: 'POST', body: JSON.stringify({ paths }) },
    ),
};
