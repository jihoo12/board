import type { ClientMsg, El, ServerMsg } from "../../shared/types";

export type ConnStatus = "connecting" | "online" | "offline" | "deleted";

/** WebSocket connection to the board's Durable Object, with batching + auto-reconnect. */
export class Sync {
  private ws: WebSocket | null = null;
  private queue = new Map<string, El>();
  private flushTimer: number | null = null;
  private pingTimer: number | null = null;
  private retry = 0;
  private closed = false;
  ready = false;

  constructor(
    private boardId: string,
    private onMessage: (m: ServerMsg) => void,
    private onStatus: (s: ConnStatus) => void,
  ) {}

  connect() {
    if (this.closed) return;
    this.onStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/boards/${this.boardId}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.pingTimer = window.setInterval(() => this.send({ t: "ping" }), 25_000);
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "init") {
        this.ready = true;
        this.onStatus("online");
      }
      if (m.t === "deleted") {
        this.closed = true;
        this.onStatus("deleted");
      }
      this.onMessage(m);
      if (m.t === "init") this.flush();
    };
    ws.onclose = (ev) => {
      this.ready = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.closed || ev.code === 4004) return;
      this.onStatus("offline");
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
  }

  /** Queue element changes; they are sent in small batches. */
  push(els: El[]) {
    for (const e of els) this.queue.set(e.id, e);
    if (this.flushTimer == null) this.flushTimer = window.setTimeout(() => this.flush(), 35);
  }

  flush() {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.ready || !this.queue.size) return;
    this.send({ t: "upsert", elements: [...this.queue.values()] });
    this.queue.clear();
  }

  get pending() {
    return this.queue.size;
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && (this.ready || msg.t === "ping")) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this.flush();
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000);
  }
}
