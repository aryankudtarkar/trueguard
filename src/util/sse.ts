/**
 * Incremental SSE parser over a byte/text stream. Yields events as
 * `{ data, id }` using the verified TrueForge framing:
 *   data: {json}\n\n   with an optional `id: N` line per event.
 */
export interface SseEvent {
  data: string;
  id?: string;
}

export class SseParser {
  private buffer = '';

  /** Feed a decoded chunk; returns complete events seen so far. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) >= 0) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      let data: string | undefined;
      let id: string | undefined;
      for (const line of raw.split('\n')) {
        if (line.startsWith('data:')) { data = line.slice(5).trim(); }
        else if (line.startsWith('id:')) { id = line.slice(3).trim(); }
      }
      if (data !== undefined && data !== '[DONE]') { events.push({ data, id }); }
    }
    return events;
  }
}
