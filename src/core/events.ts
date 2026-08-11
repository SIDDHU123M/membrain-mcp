import { EventEmitter } from 'node:events';

export interface MemoryEvent {
  type: 'saved' | 'updated' | 'deleted';
  id: number;
  source?: string;
}

// The wire. Every write funnels through core/memories.ts regardless of who
// asked (UI, REST, MCP, import), so emitting there is enough for the web UI
// to watch agents write in real time via GET /api/events.
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitMemoryEvent(e: MemoryEvent): void {
  bus.emit('memory', e);
}
