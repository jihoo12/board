import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import { shouldReplace, type El, type ElType, type Peer, type ServerMsg } from "../../shared/types";
import {
  DEFAULT_STYLE, fitText, fontString, LABEL_PAD, labelLines, LINE_HEIGHT, makeElement, randomId, randomSeed,
  type StyleState,
} from "./elements";
import {
  absPoints, borderPoint, boxContains, boxesIntersect, center, elBox, handlePos, HANDLE_CURSORS,
  HANDLES, hasLabel, hitTest, isBindable, isLinear, normBox, simplify, unionBox, type Box, type Handle, type Pt,
} from "./geometry";
import { drawElement, drawGrid, forgetCache } from "./render";
import { Sync, type ConnStatus } from "./sync";

export type Tool =
  | "select" | "hand" | "rectangle" | "diamond" | "ellipse" | "arrow" | "line" | "freedraw" | "text"
  | "sticky" | "image" | "frame" | "eraser" | "laser";

export interface PeerView extends Peer {
  x: number;
  y: number;
  hasCursor: boolean;
}

export interface EditorState {
  tool: Tool;
  toolLock: boolean;
  style: StyleState;
  selectedIds: string[];
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  peers: PeerView[];
  self: Peer | null;
  status: ConnStatus;
  editingId: string | null;
  grid: boolean;
  theme: "light" | "dark";
  canEdit: boolean;
  menu: { x: number; y: number } | null;
  toast: string | null;
  empty: boolean;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; camX: number; camY: number }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; base: string[] }
  | { kind: "move"; start: Pt; orig: Map<string, El>; arrows: string[]; moved: boolean }
  | { kind: "resize"; handle: Handle; box: Box; orig: Map<string, El>; arrows: string[] }
  | { kind: "point"; id: string; index: number }
  | { kind: "create"; id: string; x0: number; y0: number }
  | { kind: "draw"; id: string; raw: Pt[] }
  | { kind: "erase"; ids: Set<string>; last: Pt }
  | { kind: "laser" };

interface HistoryEntry {
  items: { id: string; before: El | null; after: El }[];
}

interface Remote {
  peer: Peer;
  x: number;
  y: number;
  dx: number; // displayed (smoothed) position
  dy: number;
  hasCursor: boolean;
  selection: string[];
  laser: { x: number; y: number; t: number }[][];
}

const LASER_TTL = 1100;
const CLIPBOARD_TAG = "inkboard/elements";
const GRID = 20;

const TOOL_KEYS: Record<string, Tool> = {
  v: "select", "1": "select", h: "hand", r: "rectangle", "2": "rectangle", d: "diamond", "3": "diamond",
  o: "ellipse", "4": "ellipse", a: "arrow", "5": "arrow", l: "line", "6": "line", p: "freedraw", "7": "freedraw",
  t: "text", "8": "text", s: "sticky", "9": "sticky", f: "frame", e: "eraser", k: "laser", i: "image",
};

export class Editor {
  // ---- document ----
  els = new Map<string, El>();
  private sortedCache: El[] | null = null;
  private maxZ = 0;
  private minZ = 0;

  // ---- view ----
  cam = { x: 0, y: 0, zoom: 1 };
  private host!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private rc!: RoughCanvas;
  private textarea!: HTMLTextAreaElement;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private connectTimer = 0;

  // ---- interaction ----
  private drag: Drag | null = null;
  private pointers = new Map<number, Pt>();
  private pinch: { dist: number; center: Pt; cam: { x: number; y: number; zoom: number } } | null = null;
  private spaceDown = false;
  private ctrlDown = false;
  private lastScene: Pt = [0, 0];
  private hoverBind: string | null = null;
  private guides: { x: number[]; y: number[] } = { x: [], y: [] };
  private erasing = new Set<string>();
  private editingNew = false;
  private laser: { x: number; y: number; t: number }[][] = [];
  private lastCursorSent = 0;

  // ---- history ----
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private pending = new Map<string, El | null>();

  // ---- collaboration ----
  private sync: Sync | null = null;
  private remotes = new Map<string, Remote>();
  private initialized = false;
  private images = new Map<string, HTMLImageElement>();

  boardId = "";
  onLocalChange: (() => void) | null = null;

  state: EditorState = {
    tool: "select",
    toolLock: false,
    style: { ...DEFAULT_STYLE },
    selectedIds: [],
    zoom: 1,
    canUndo: false,
    canRedo: false,
    peers: [],
    self: null,
    status: "connecting",
    editingId: null,
    grid: false,
    theme: "light",
    canEdit: false,
    menu: null,
    toast: null,
    empty: true,
  };
  private listeners = new Set<() => void>();
  private toastTimer = 0;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem("inkboard:prefs") || "{}");
      if (saved.style) this.state.style = { ...DEFAULT_STYLE, ...saved.style };
      if (saved.theme) this.state.theme = saved.theme;
      if (typeof saved.grid === "boolean") this.state.grid = saved.grid;
    } catch {
      /* ignore */
    }
  }

  // =====================================================================
  // state store (consumed by React via useSyncExternalStore)
  // =====================================================================
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  setState(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
    if ("grid" in patch || "theme" in patch) this.requestRender();
    if ("style" in patch || "theme" in patch || "grid" in patch) {
      try {
        localStorage.setItem(
          "inkboard:prefs",
          JSON.stringify({ style: this.state.style, theme: this.state.theme, grid: this.state.grid }),
        );
      } catch {
        /* ignore */
      }
    }
  }
  toast(msg: string) {
    this.setState({ toast: msg });
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.setState({ toast: null }), 2600);
  }

  // =====================================================================
  // lifecycle
  // =====================================================================
  mount(host: HTMLDivElement) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "board-canvas";
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.rc = rough.canvas(this.canvas);
    this.textarea = document.createElement("textarea");
    this.textarea.className = "text-editor";
    this.textarea.spellcheck = false;
    this.textarea.style.display = "none";
    host.appendChild(this.textarea);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("dblclick", this.onDoubleClick);
    c.addEventListener("contextmenu", this.onContextMenu);
    c.addEventListener("dragover", (e) => e.preventDefault());
    c.addEventListener("drop", this.onDrop);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("copy", this.onCopy);
    document.addEventListener("cut", this.onCut);
    document.addEventListener("paste", this.onPaste);
    this.textarea.addEventListener("input", this.onTextInput);
    this.textarea.addEventListener("keydown", this.onTextKey);
    this.textarea.addEventListener("blur", () => this.finishEditing());
    // canvas text doesn't trigger webfont loads by itself – request them and repaint when ready
    if (document.fonts) {
      const sample = "Aa가나";
      Promise.all(
        ['20px "Patrick Hand"', '20px "Gaegu"', '20px "Inter"', '20px "Noto Sans KR"', '20px "JetBrains Mono"'].map((f) =>
          document.fonts.load(f, sample).catch(() => []),
        ),
      ).then(() => this.requestRender());
      document.fonts.addEventListener("loadingdone", () => this.requestRender());
    }
  }

  destroy() {
    this.finishEditing();
    this.sync?.close();
    clearTimeout(this.connectTimer);
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("copy", this.onCopy);
    document.removeEventListener("cut", this.onCut);
    document.removeEventListener("paste", this.onPaste);
    this.host.innerHTML = "";
  }

  connect(boardId: string, canEdit: boolean) {
    this.boardId = boardId;
    this.setState({ canEdit });
    this.sync = new Sync(boardId, (m) => this.onServer(m), (s) => this.setState({ status: s }));
    // deferred so a mount→unmount→mount cycle (React StrictMode) doesn't open a throwaway socket
    const sync = this.sync;
    this.connectTimer = window.setTimeout(() => sync.connect(), 0);
  }

  /** Flush unsent changes. Returns true if nothing is pending. */
  flush() {
    this.sync?.flush();
    return !this.sync || this.sync.pending === 0;
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.requestRender();
  }

  // =====================================================================
  // coordinates & camera
  // =====================================================================
  toScene(sx: number, sy: number): Pt {
    return [sx / this.cam.zoom + this.cam.x, sy / this.cam.zoom + this.cam.y];
  }
  toScreen(x: number, y: number): Pt {
    return [(x - this.cam.x) * this.cam.zoom, (y - this.cam.y) * this.cam.zoom];
  }
  private eventScreen(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  private setCam(x: number, y: number, zoom = this.cam.zoom) {
    this.cam = { x, y, zoom };
    if (zoom !== this.state.zoom) this.setState({ zoom });
    this.positionTextarea();
    this.requestRender();
  }
  zoomAt(sx: number, sy: number, zoom: number) {
    zoom = Math.min(8, Math.max(0.1, zoom));
    const [wx, wy] = this.toScene(sx, sy);
    this.setCam(wx - sx / zoom, wy - sy / zoom, zoom);
  }
  zoomBy(factor: number) {
    this.zoomAt(this.width / 2, this.height / 2, this.cam.zoom * factor);
  }
  resetZoom() {
    this.zoomAt(this.width / 2, this.height / 2, 1);
  }
  zoomToFit(els?: El[]) {
    const list = els && els.length ? els : this.live();
    const b = unionBox(list.map(elBox));
    if (!b) {
      this.setCam(-this.width / 2, -this.height / 2, 1);
      return;
    }
    const pad = 80;
    const zoom = Math.min(2, Math.max(0.1, Math.min((this.width - pad * 2) / Math.max(b.w, 1), (this.height - pad * 2) / Math.max(b.h, 1))));
    this.setCam(b.x + b.w / 2 - this.width / 2 / zoom, b.y + b.h / 2 - this.height / 2 / zoom, zoom);
  }
  scrollToPeer(cid: string) {
    const r = this.remotes.get(cid);
    if (!r || !r.hasCursor) return;
    this.setCam(r.x - this.width / 2 / this.cam.zoom, r.y - this.height / 2 / this.cam.zoom);
  }
  private viewBox(): Box {
    return { x: this.cam.x, y: this.cam.y, w: this.width / this.cam.zoom, h: this.height / this.cam.zoom };
  }

  // =====================================================================
  // document helpers
  // =====================================================================
  live(): El[] {
    if (!this.sortedCache) {
      this.sortedCache = [...this.els.values()]
        .filter((e) => !e.isDeleted)
        .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    }
    return this.sortedCache;
  }
  private invalidate() {
    this.sortedCache = null;
    const empty = this.live().length === 0;
    if (empty !== this.state.empty) this.setState({ empty });
    this.requestRender();
  }
  private trackZ(e: El) {
    if (e.z > this.maxZ) this.maxZ = e.z;
    if (e.z < this.minZ) this.minZ = e.z;
  }
  selected(): El[] {
    return this.state.selectedIds.map((id) => this.els.get(id)).filter((e): e is El => !!e && !e.isDeleted);
  }
  private expandGroups(ids: Iterable<string>): string[] {
    const out = new Set<string>();
    const groups = new Set<string>();
    for (const id of ids) {
      out.add(id);
      const g = this.els.get(id)?.groupId;
      if (g) groups.add(g);
    }
    if (groups.size) for (const e of this.live()) if (e.groupId && groups.has(e.groupId)) out.add(e.id);
    return [...out];
  }
  select(ids: string[]) {
    const same = ids.length === this.state.selectedIds.length && ids.every((id, i) => id === this.state.selectedIds[i]);
    if (same) return;
    this.setState({ selectedIds: ids });
    this.sync?.send({ t: "selection", ids });
    this.requestRender();
  }

  /** Apply local changes: bumps versions, records history, broadcasts. */
  private commit(changes: El[]) {
    if (!this.state.canEdit || !changes.length) return;
    const out: El[] = [];
    for (const ch of changes) {
      const before = this.els.get(ch.id);
      if (!this.pending.has(ch.id)) this.pending.set(ch.id, before ? before : null);
      const next: El = { ...ch, version: (before?.version ?? 0) + 1, nonce: randomSeed() };
      this.els.set(next.id, next);
      this.trackZ(next);
      out.push(next);
    }
    this.sync?.push(out);
    this.invalidate();
    this.onLocalChange?.();
  }
  /** Close the current history step. */
  private commitHistory() {
    if (!this.pending.size) return;
    const items: HistoryEntry["items"] = [];
    for (const [id, before] of this.pending) {
      const after = this.els.get(id);
      if (!after) continue;
      if (!before && after.isDeleted) continue; // created and removed in the same step
      items.push({ id, before, after });
    }
    this.pending.clear();
    if (!items.length) return;
    this.undoStack.push({ items });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.setState({ canUndo: true, canRedo: false });
  }
  private change(changes: El[]) {
    this.commit(changes);
    this.commitHistory();
  }

  private applyHistory(entry: HistoryEntry, dir: "undo" | "redo") {
    const out: El[] = [];
    for (const it of entry.items) {
      const cur = this.els.get(it.id);
      const target = dir === "undo" ? (it.before ?? { ...it.after, isDeleted: true }) : it.after;
      const next: El = { ...target, version: Math.max(cur?.version ?? 0, target.version) + 1, nonce: randomSeed() };
      this.els.set(next.id, next);
      out.push(next);
    }
    this.sync?.push(out);
    this.invalidate();
    this.onLocalChange?.();
    this.select(this.expandGroups(out.filter((e) => !e.isDeleted).map((e) => e.id)));
  }
  undo() {
    if (!this.state.canEdit) return;
    this.finishEditing();
    const e = this.undoStack.pop();
    if (!e) return;
    this.applyHistory(e, "undo");
    this.redoStack.push(e);
    this.setState({ canUndo: this.undoStack.length > 0, canRedo: true });
  }
  redo() {
    if (!this.state.canEdit) return;
    this.finishEditing();
    const e = this.redoStack.pop();
    if (!e) return;
    this.applyHistory(e, "redo");
    this.undoStack.push(e);
    this.setState({ canUndo: true, canRedo: this.redoStack.length > 0 });
  }

  // =====================================================================
  // server messages
  // =====================================================================
  private onServer(m: ServerMsg) {
    switch (m.t) {
      case "init": {
        const server = new Map(m.elements.map((e) => [e.id, e]));
        for (const e of m.elements) {
          if (shouldReplace(this.els.get(e.id), e)) this.els.set(e.id, e);
          this.trackZ(e);
        }
        // anything we changed while offline that the server doesn't know yet
        const resend = [...this.els.values()].filter((e) => {
          const s = server.get(e.id);
          return !s || (s !== e && shouldReplace(s, e));
        });
        if (resend.length && this.state.canEdit) this.sync?.push(resend);
        this.remotes.clear();
        for (const p of m.peers) this.addRemote(p);
        this.setState({ self: m.self, canEdit: m.self.canEdit });
        this.invalidate();
        if (!this.initialized) {
          this.initialized = true;
          if (this.live().length) this.onLocalChange?.(); // make sure the dashboard gets a thumbnail
          this.zoomToFit();
          if (this.cam.zoom > 1) this.zoomAt(this.width / 2, this.height / 2, 1);
          this.lastScene = this.toScene(this.width / 2, this.height / 2); // default paste position
        }
        this.publishPeers();
        break;
      }
      case "upsert": {
        let changed = false;
        for (const e of m.elements) {
          if (shouldReplace(this.els.get(e.id), e)) {
            this.els.set(e.id, e);
            this.trackZ(e);
            changed = true;
          }
        }
        if (changed) {
          this.invalidate();
          const sel = this.state.selectedIds.filter((id) => !this.els.get(id)?.isDeleted);
          if (sel.length !== this.state.selectedIds.length) this.select(sel);
        }
        break;
      }
      case "join":
        this.addRemote(m.peer);
        this.publishPeers();
        break;
      case "leave":
        this.remotes.delete(m.cid);
        this.publishPeers();
        this.requestRender();
        break;
      case "cursor": {
        const r = this.remotes.get(m.cid);
        if (r) {
          if (!r.hasCursor) {
            r.dx = m.x;
            r.dy = m.y;
            r.hasCursor = true;
            this.publishPeers();
          }
          r.x = m.x;
          r.y = m.y;
          this.requestRender();
        }
        break;
      }
      case "laser": {
        const r = this.remotes.get(m.cid);
        if (r) {
          if (m.start || !r.laser.length) r.laser.push([]);
          r.laser[r.laser.length - 1].push({ x: m.x, y: m.y, t: performance.now() });
          r.x = m.x;
          r.y = m.y;
          r.hasCursor = true;
          this.requestRender();
        }
        break;
      }
      case "selection": {
        const r = this.remotes.get(m.cid);
        if (r) {
          r.selection = m.ids;
          this.requestRender();
        }
        break;
      }
      case "error":
        this.toast(m.message);
        break;
      case "deleted":
        this.setState({ status: "deleted" });
        break;
    }
  }
  private addRemote(p: Peer) {
    this.remotes.set(p.cid, { peer: p, x: 0, y: 0, dx: 0, dy: 0, hasCursor: false, selection: [], laser: [] });
  }
  private publishPeers() {
    this.setState({
      peers: [...this.remotes.values()].map((r) => ({ ...r.peer, x: r.x, y: r.y, hasCursor: r.hasCursor })),
    });
  }

  // =====================================================================
  // images
  // =====================================================================
  getImage = (assetId: string): HTMLImageElement | null => {
    let img = this.images.get(assetId);
    if (!img) {
      img = new Image();
      img.onload = () => this.requestRender();
      img.src = `/api/assets/${assetId}`;
      this.images.set(assetId, img);
    }
    return img;
  };

  async insertImage(file: File, at?: Pt) {
    if (!this.state.canEdit) return;
    if (!file.type.startsWith("image/")) {
      this.toast("이미지 파일만 넣을 수 있어요");
      return;
    }
    this.toast("이미지 업로드 중…");
    try {
      const { blob, w, h } = await downscaleImage(file, 1600);
      const res = await fetch(`/api/boards/${this.boardId}/assets`, {
        method: "POST",
        headers: { "content-type": blob.type },
        body: blob,
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error || "업로드 실패");
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await img.decode().catch(() => {});
      this.images.set(data.id, img);
      const max = 480 / Math.max(this.cam.zoom, 0.5);
      const s = Math.min(1, max / Math.max(w, h));
      const [cx, cy] = at ?? this.toScene(this.width / 2, this.height / 2);
      const el = makeElement("image", {
        x: cx - (w * s) / 2, y: cy - (h * s) / 2, w: w * s, h: h * s, assetId: data.id, z: ++this.maxZ,
      }, this.state.style);
      this.change([el]);
      this.select([el.id]);
      this.setState({ toast: null });
    } catch (e) {
      this.toast(`이미지를 올리지 못했어요: ${(e as Error).message}`);
    }
  }

  pickImage(at?: Pt) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) this.insertImage(f, at);
    };
    input.click();
  }

  // =====================================================================
  // tools & style
  // =====================================================================
  setTool(tool: Tool) {
    this.finishEditing();
    if (!this.state.canEdit && !["select", "hand", "laser"].includes(tool)) return;
    if (tool === "image") {
      this.pickImage();
      return;
    }
    if (tool !== "select") this.select([]);
    this.setState({ tool, menu: null });
    this.updateCursor();
  }

  /** Change style for the current selection (and future elements). */
  setStyle(patch: Partial<StyleState>) {
    const style = { ...this.state.style, ...patch };
    this.setState({ style });
    const sel = this.selected();
    if (!sel.length || !this.state.canEdit) return;
    const changes = sel.map((e) => {
      let n: El = { ...e };
      for (const [k, v] of Object.entries(patch) as [keyof StyleState, never][]) {
        if (k === "stickyColor") {
          if (e.type === "sticky") n.fillColor = v;
        } else if (k === "fillColor" || k === "fillStyle") {
          if (e.type !== "sticky" && e.type !== "frame" && e.type !== "image" && e.type !== "text" && e.type !== "freedraw") (n as never as Record<string, unknown>)[k] = v;
        } else if (k === "roundness") {
          if (e.type === "rectangle") n.roundness = v;
        } else if (k === "startArrow" || k === "endArrow") {
          if (e.type === "arrow") (n as never as Record<string, unknown>)[k] = v;
        } else if (k === "curved") {
          if (e.type === "arrow" || e.type === "line") n.curved = v;
        } else if (k === "fontSize" || k === "fontFamily" || k === "textAlign") {
          if (e.text !== undefined) (n as never as Record<string, unknown>)[k] = v;
        } else if (k === "strokeColor") {
          n.strokeColor = v;
        } else {
          (n as never as Record<string, unknown>)[k] = v;
        }
      }
      if (n.text !== undefined) n = fitText(n);
      return n;
    });
    this.change(changes);
  }

  // =====================================================================
  // hit testing
  // =====================================================================
  private hitAt(p: Pt, filter?: (e: El) => boolean): El | null {
    const tol = 6 / this.cam.zoom;
    const list = this.live();
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.locked) continue;
      if (filter && !filter(e)) continue;
      if (hitTest(e, p[0], p[1], tol)) return e;
    }
    return null;
  }
  private selectionBox(): Box | null {
    return unionBox(this.selected().map(elBox));
  }
  private singleLinear(): El | null {
    const s = this.selected();
    return s.length === 1 && (s[0].type === "line" || s[0].type === "arrow") ? s[0] : null;
  }
  private handleAt(screen: Pt): Handle | null {
    const sel = this.selected();
    if (!sel.length || this.singleLinear() || !this.state.canEdit) return null;
    const b = this.selectionBox();
    if (!b) return null;
    const pad = 6 / this.cam.zoom;
    const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    for (const h of HANDLES) {
      if (sel.length === 1 && sel[0].type === "text" && (h === "n" || h === "s")) continue;
      const [hx, hy] = this.toScreen(...handlePos(box, h));
      if (Math.abs(hx - screen[0]) <= 7 && Math.abs(hy - screen[1]) <= 7) return h;
    }
    return null;
  }
  /** Returns point handle index (or -(i+1)-1000 for a midpoint between i and i+1). */
  private pointHandleAt(screen: Pt): number | null {
    const el = this.singleLinear();
    if (!el || !this.state.canEdit) return null;
    const pts = absPoints(el);
    for (let i = 0; i < pts.length; i++) {
      const [hx, hy] = this.toScreen(pts[i][0], pts[i][1]);
      if (Math.hypot(hx - screen[0], hy - screen[1]) <= 8) return i;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [hx, hy] = this.toScreen((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      if (Math.hypot(hx - screen[0], hy - screen[1]) <= 7) return -1000 - i;
    }
    return null;
  }
  private bindTargetAt(p: Pt, exclude: string): El | null {
    return this.hitAt(p, (e) => e.id !== exclude && isBindable(e));
  }

  // =====================================================================
  // arrows & binding
  // =====================================================================
  private withAbsPoints(el: El, pts: Pt[]): El {
    const [x, y] = pts[0];
    const points = pts.map(([px, py]) => [px - x, py - y] as [number, number]);
    const b = elBox({ ...el, x, y, points });
    return { ...el, x, y, points, w: b.w, h: b.h };
  }
  private rebind(a: El): El {
    const pts = absPoints(a);
    if (pts.length < 2) return a;
    const s = a.startBind ? this.els.get(a.startBind) : undefined;
    const e = a.endBind ? this.els.get(a.endBind) : undefined;
    const sOk = s && !s.isDeleted ? s : undefined;
    const eOk = e && !e.isDeleted ? e : undefined;
    const last = pts.length - 1;
    if (sOk) pts[0] = borderPoint(sOk, last > 1 ? pts[1] : eOk ? center(eOk) : pts[last]);
    if (eOk) pts[last] = borderPoint(eOk, last > 1 ? pts[last - 1] : sOk ? center(sOk) : pts[0]);
    return this.withAbsPoints(a, pts);
  }
  private arrowsBoundTo(ids: Set<string>): string[] {
    const out: string[] = [];
    for (const e of this.live()) {
      if (e.type !== "arrow" || ids.has(e.id)) continue;
      if ((e.startBind && ids.has(e.startBind)) || (e.endBind && ids.has(e.endBind))) out.push(e.id);
    }
    return out;
  }

  // =====================================================================
  // pointer events
  // =====================================================================
  private onPointerDown = (e: PointerEvent) => {
    this.setState({ menu: null });
    if (this.state.editingId) {
      this.finishEditing();
      if (this.state.tool === "text") return;
    }
    const screen = this.eventScreen(e);
    this.pointers.set(e.pointerId, screen);
    this.canvas.setPointerCapture(e.pointerId);

    // two-finger pinch / pan
    if (this.pointers.size === 2) {
      this.cancelDrag();
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        dist: Math.hypot(a[0] - b[0], a[1] - b[1]),
        center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        cam: { ...this.cam },
      };
      return;
    }
    if (this.pointers.size > 2) return;

    const p = this.toScene(...screen);
    this.lastScene = p;
    const tool = this.state.tool;

    if (e.button === 1 || (e.button === 0 && (this.spaceDown || tool === "hand"))) {
      this.drag = { kind: "pan", sx: screen[0], sy: screen[1], camX: this.cam.x, camY: this.cam.y };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;

    if (tool === "laser") {
      this.laser.push([{ x: p[0], y: p[1], t: performance.now() }]);
      this.sync?.send({ t: "laser", x: p[0], y: p[1], start: true });
      this.drag = { kind: "laser" };
      return;
    }
    if (!this.state.canEdit && tool !== "select") return;

    if (tool === "select") {
      // line point handles
      const ph = this.pointHandleAt(screen);
      if (ph !== null) {
        const el = this.singleLinear()!;
        let index = ph;
        if (ph <= -1000) {
          const i = -1000 - ph;
          const pts = absPoints(el);
          pts.splice(i + 1, 0, [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]);
          this.commit([this.withAbsPoints(el, pts)]);
          index = i + 1;
        }
        this.drag = { kind: "point", id: el.id, index };
        return;
      }
      const handle = this.handleAt(screen);
      if (handle) {
        const sel = this.selected();
        const orig = new Map(sel.map((s) => [s.id, s]));
        this.drag = {
          kind: "resize", handle, box: this.selectionBox()!, orig,
          arrows: this.arrowsBoundTo(new Set(orig.keys())),
        };
        return;
      }
      const hit = this.hitAt(p);
      if (hit) {
        let ids = this.state.selectedIds;
        if (e.shiftKey) {
          const group = this.expandGroups([hit.id]);
          ids = ids.includes(hit.id) ? ids.filter((i) => !group.includes(i)) : [...ids, ...group];
          this.select(ids);
        } else if (!ids.includes(hit.id)) {
          ids = this.expandGroups([hit.id]);
          this.select(ids);
        }
        if (!this.state.canEdit || !ids.length) return;
        if (e.altKey) {
          const clones = this.cloneElements(this.selected(), 0, 0);
          this.commit(clones);
          this.select(clones.map((c) => c.id));
        }
        this.beginMove(p);
        return;
      }
      this.drag = { kind: "marquee", x0: p[0], y0: p[1], x1: p[0], y1: p[1], base: e.shiftKey ? this.state.selectedIds : [] };
      if (!e.shiftKey) this.select([]);
      return;
    }

    if (tool === "eraser") {
      this.drag = { kind: "erase", ids: new Set(), last: p };
      this.eraseAlong(p, p);
      return;
    }

    const sp = this.snapPoint(p, e);
    const style = this.state.style;

    if (tool === "text") {
      const hit = this.hitAt(p, (el) => el.type === "text" || hasLabel(el));
      if (hit) {
        this.startEditing(hit.id);
        return;
      }
      const el = makeElement("text", { x: sp[0], y: sp[1] - (style.fontSize * LINE_HEIGHT) / 2, z: ++this.maxZ }, style);
      this.commit([fitText(el)]);
      this.startEditing(el.id, true);
      if (!this.state.toolLock) this.setState({ tool: "select" });
      return;
    }

    if (tool === "freedraw") {
      const el = makeElement("freedraw", { x: p[0], y: p[1], points: [[0, 0]], z: ++this.maxZ }, style);
      this.commit([el]);
      this.drag = { kind: "draw", id: el.id, raw: [p] };
      return;
    }

    if (tool === "arrow" || tool === "line") {
      const target = tool === "arrow" ? this.bindTargetAt(p, "") : null;
      const el = makeElement(tool, {
        x: sp[0], y: sp[1], points: [[0, 0], [0, 0]], z: ++this.maxZ, startBind: target?.id ?? null,
      }, style);
      this.commit([el]);
      this.drag = { kind: "point", id: el.id, index: 1 };
      return;
    }

    // box-like shapes
    const type = tool as ElType;
    const z = type === "frame" ? --this.minZ : ++this.maxZ;
    const el = makeElement(type, { x: sp[0], y: sp[1], w: 0, h: 0, z }, style);
    if (type === "frame") el.name = `프레임 ${this.live().filter((x) => x.type === "frame").length + 1}`;
    this.commit([el]);
    this.drag = { kind: "create", id: el.id, x0: sp[0], y0: sp[1] };
  };

  private beginMove(p: Pt) {
    const sel = this.selected();
    const ids = new Set(sel.map((s) => s.id));
    // frames carry the elements fully inside them
    for (const f of sel) {
      if (f.type !== "frame") continue;
      const fb = elBox(f);
      for (const e of this.live()) if (e.type !== "frame" && boxContains(fb, elBox(e))) ids.add(e.id);
    }
    const orig = new Map<string, El>();
    for (const id of ids) orig.set(id, this.els.get(id)!);
    this.drag = { kind: "move", start: p, orig, arrows: this.arrowsBoundTo(ids), moved: false };
  }

  private snapPoint(p: Pt, e?: { ctrlKey: boolean; metaKey: boolean }): Pt {
    if (!this.state.grid || e?.ctrlKey || e?.metaKey) return p;
    return [Math.round(p[0] / GRID) * GRID, Math.round(p[1] / GRID) * GRID];
  }

  private onPointerMove = (e: PointerEvent) => {
    const screen = this.eventScreen(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, screen);

    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const c: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const z0 = this.pinch.cam.zoom;
      const zoom = Math.min(8, Math.max(0.1, (z0 * dist) / Math.max(this.pinch.dist, 1)));
      const wx = this.pinch.center[0] / z0 + this.pinch.cam.x;
      const wy = this.pinch.center[1] / z0 + this.pinch.cam.y;
      this.setCam(wx - c[0] / zoom, wy - c[1] / zoom, zoom);
      return;
    }

    const p = this.toScene(...screen);
    this.lastScene = p;
    this.ctrlDown = e.ctrlKey || e.metaKey;

    // presence
    const now = performance.now();
    if (now - this.lastCursorSent > 45 && e.target === this.canvas) {
      this.lastCursorSent = now;
      this.sync?.send({ t: "cursor", x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10 });
    }

    const d = this.drag;
    if (!d) {
      if (e.target === this.canvas) this.updateHoverCursor(screen, p);
      return;
    }

    switch (d.kind) {
      case "pan":
        this.setCam(d.camX - (screen[0] - d.sx) / this.cam.zoom, d.camY - (screen[1] - d.sy) / this.cam.zoom);
        break;
      case "laser": {
        const stroke = this.laser[this.laser.length - 1];
        stroke.push({ x: p[0], y: p[1], t: now });
        this.sync?.send({ t: "laser", x: p[0], y: p[1] });
        this.requestRender();
        break;
      }
      case "marquee": {
        d.x1 = p[0];
        d.y1 = p[1];
        const box = normBox(d.x0, d.y0, d.x1, d.y1);
        const ids = this.live().filter((el) => !el.locked && boxContains(box, elBox(el))).map((el) => el.id);
        this.select(this.expandGroups(new Set([...d.base, ...ids])));
        this.requestRender();
        break;
      }
      case "move":
        this.doMove(d, p, e);
        break;
      case "resize":
        this.doResize(d, p, e.shiftKey);
        break;
      case "point":
        this.doPoint(d, p, e);
        break;
      case "create": {
        const el = this.els.get(d.id)!;
        let [x1, y1] = this.snapPoint(p, e);
        if (e.shiftKey) {
          const s = Math.max(Math.abs(x1 - d.x0), Math.abs(y1 - d.y0));
          x1 = d.x0 + s * Math.sign(x1 - d.x0 || 1);
          y1 = d.y0 + s * Math.sign(y1 - d.y0 || 1);
        }
        const b = normBox(d.x0, d.y0, x1, y1);
        this.commit([{ ...el, ...b }]);
        break;
      }
      case "draw": {
        const el = this.els.get(d.id)!;
        const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
        for (const ce of evs.length ? evs : [e]) d.raw.push(this.toScene(...this.eventScreen(ce)));
        const pts = d.raw.map(([x, y]) => [x - el.x, y - el.y] as [number, number]);
        const b = elBox({ ...el, points: pts });
        this.commit([{ ...el, points: pts, w: b.w, h: b.h }]);
        break;
      }
      case "erase":
        this.eraseAlong(d.last, p);
        d.last = p;
        break;
    }
  };

  private doMove(d: Extract<Drag, { kind: "move" }>, p: Pt, e: PointerEvent) {
    let dx = p[0] - d.start[0];
    let dy = p[1] - d.start[1];
    if (!d.moved && Math.hypot(dx, dy) * this.cam.zoom < 3) return;
    d.moved = true;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    this.guides = { x: [], y: [] };
    const box = unionBox([...d.orig.values()].map(elBox))!;
    const noSnap = e.ctrlKey || e.metaKey;
    if (!noSnap && this.state.grid) {
      dx = Math.round((box.x + dx) / GRID) * GRID - box.x;
      dy = Math.round((box.y + dy) / GRID) * GRID - box.y;
    } else if (!noSnap) {
      [dx, dy] = this.smartSnap(box, dx, dy, d.orig);
    }
    const changes: El[] = [];
    for (const o of d.orig.values()) {
      const n: El = { ...o, x: o.x + dx, y: o.y + dy };
      // an arrow moved on its own detaches from shapes that stay put
      if (n.type === "arrow") {
        if (n.startBind && !d.orig.has(n.startBind)) n.startBind = null;
        if (n.endBind && !d.orig.has(n.endBind)) n.endBind = null;
      }
      changes.push(n);
    }
    this.commit(changes);
    this.commit(d.arrows.map((id) => this.rebind(this.els.get(id)!)));
  }

  /** Figma-style alignment snapping against nearby elements. Returns adjusted delta. */
  private smartSnap(box: Box, dx: number, dy: number, moving: Map<string, El>): [number, number] {
    const th = 6 / this.cam.zoom;
    const view = this.viewBox();
    const mb = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
    const mxs = [mb.x, mb.x + mb.w / 2, mb.x + mb.w];
    const mys = [mb.y, mb.y + mb.h / 2, mb.y + mb.h];
    let bestX: { d: number; v: number } | null = null;
    let bestY: { d: number; v: number } | null = null;
    for (const el of this.live()) {
      if (moving.has(el.id)) continue;
      const b = elBox(el);
      if (!boxesIntersect(b, view)) continue;
      for (const v of [b.x, b.x + b.w / 2, b.x + b.w]) {
        for (const m of mxs) {
          const dd = v - m;
          if (Math.abs(dd) < th && (!bestX || Math.abs(dd) < Math.abs(bestX.d))) bestX = { d: dd, v };
        }
      }
      for (const v of [b.y, b.y + b.h / 2, b.y + b.h]) {
        for (const m of mys) {
          const dd = v - m;
          if (Math.abs(dd) < th && (!bestY || Math.abs(dd) < Math.abs(bestY.d))) bestY = { d: dd, v };
        }
      }
    }
    if (bestX) {
      dx += bestX.d;
      this.guides.x.push(bestX.v);
    }
    if (bestY) {
      dy += bestY.d;
      this.guides.y.push(bestY.v);
    }
    return [dx, dy];
  }

  private doResize(d: Extract<Drag, { kind: "resize" }>, p: Pt, shift: boolean) {
    const B = d.box;
    const h = d.handle;
    const only = d.orig.size === 1 ? [...d.orig.values()][0] : null;
    const keepAspect = shift !== !!(only && (only.type === "image" || only.type === "text")) || (!only && shift);
    let x1 = B.x, y1 = B.y, x2 = B.x + B.w, y2 = B.y + B.h;
    const [px, py] = this.snapPoint(p);
    if (h.includes("w")) x1 = px;
    if (h.includes("e")) x2 = px;
    if (h.includes("n")) y1 = py;
    if (h.includes("s")) y2 = py;
    let sx = B.w ? (x2 - x1) / B.w : 1;
    let sy = B.h ? (y2 - y1) / B.h : 1;
    if (keepAspect || (only?.type === "text")) {
      const s =
        h.length === 2 ? Math.max(Math.abs(sx), Math.abs(sy)) : h === "n" || h === "s" ? Math.abs(sy) : Math.abs(sx);
      sx = s;
      sy = s;
      // anchor at the opposite side
      const ax = h.includes("w") ? B.x + B.w : h.includes("e") ? B.x : B.x + B.w / 2;
      const ay = h.includes("n") ? B.y + B.h : h.includes("s") ? B.y : B.y + B.h / 2;
      const nw = B.w * s, nh = B.h * s;
      x1 = h.includes("w") ? ax - nw : h.includes("e") ? ax : ax - nw / 2;
      y1 = h.includes("n") ? ay - nh : h.includes("s") ? ay : ay - nh / 2;
      x2 = x1 + nw;
      y2 = y1 + nh;
    }
    const nb = normBox(x1, y1, x2, y2);
    sx = B.w ? Math.max(nb.w, 1) / B.w : 1;
    sy = B.h ? Math.max(nb.h, 1) / B.h : 1;
    const changes: El[] = [];
    for (const o of d.orig.values()) {
      const n: El = { ...o };
      if (o.points) {
        n.x = nb.x + (o.x - B.x) * sx;
        n.y = nb.y + (o.y - B.y) * sy;
        n.points = o.points.map(([a, b]) => [a * sx, b * sy]);
        const bb = elBox(n);
        n.w = bb.w;
        n.h = bb.h;
      } else {
        n.x = nb.x + (o.x - B.x) * sx;
        n.y = nb.y + (o.y - B.y) * sy;
        n.w = Math.max(1, o.w * sx);
        n.h = Math.max(1, o.h * sy);
        if (o.type === "text") {
          n.fontSize = Math.max(4, (o.fontSize ?? 20) * sy);
          Object.assign(n, fitText(n));
        } else if (o.text && hasLabel(o)) {
          Object.assign(n, fitText(n));
        }
      }
      changes.push(n);
    }
    this.commit(changes);
    this.commit(d.arrows.map((id) => this.rebind(this.els.get(id)!)));
  }

  private doPoint(d: Extract<Drag, { kind: "point" }>, p: Pt, e: PointerEvent) {
    const el = this.els.get(d.id);
    if (!el) return;
    const pts = absPoints(el);
    let q = this.snapPoint(p, e);
    const isEnd = d.index === 0 || d.index === pts.length - 1;
    // shift: lock to 15° increments relative to neighbour
    if (e.shiftKey && pts.length >= 2) {
      const nb = pts[d.index === 0 ? 1 : d.index - 1];
      const ang = Math.atan2(q[1] - nb[1], q[0] - nb[0]);
      const len = Math.hypot(q[0] - nb[0], q[1] - nb[1]);
      const sn = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      q = [nb[0] + Math.cos(sn) * len, nb[1] + Math.sin(sn) * len];
    }
    pts[d.index] = q;
    let n: El = this.withAbsPoints(el, pts);
    if (el.type === "arrow" && isEnd) {
      const target = this.bindTargetAt(p, el.id);
      this.hoverBind = target?.id ?? null;
      if (d.index === 0) n.startBind = target?.id ?? null;
      else n.endBind = target?.id ?? null;
      n = this.rebind(n);
    }
    this.commit([n]);
  }

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    const hadOverlay = this.guides.x.length + this.guides.y.length > 0 || !!this.hoverBind;
    this.guides = { x: [], y: [] };
    this.hoverBind = null;
    if (hadOverlay) this.requestRender();
    if (!d) return;

    switch (d.kind) {
      case "create": {
        const el = this.els.get(d.id)!;
        let n = el;
        if (el.w < 4 && el.h < 4) {
          // click without drag → default size
          const size: Record<string, [number, number]> = {
            sticky: [200, 200], frame: [480, 320], rectangle: [140, 90], ellipse: [120, 120], diamond: [130, 110],
          };
          const [w, h] = size[el.type] ?? [100, 100];
          n = { ...el, x: el.x - w / 2, y: el.y - h / 2, w, h };
          this.commit([n]);
        }
        this.commitHistory();
        if (!this.state.toolLock) this.setState({ tool: "select" });
        this.select([n.id]);
        if (n.type === "sticky") this.startEditing(n.id);
        break;
      }
      case "point": {
        const el = this.els.get(d.id);
        if (el && el.points && el.points.length === 2) {
          const [a, b] = absPoints(el);
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) * this.cam.zoom < 4) {
            // a click with the arrow tool – drop it
            this.commit([{ ...el, isDeleted: true }]);
            this.pending.delete(el.id);
            this.commitHistory();
            break;
          }
        }
        this.commitHistory();
        if (this.state.tool === "arrow" || this.state.tool === "line") {
          if (!this.state.toolLock) this.setState({ tool: "select" });
          this.select([d.id]);
        }
        break;
      }
      case "draw": {
        const el = this.els.get(d.id)!;
        const pts = simplify(el.points as Pt[], 0.4 / this.cam.zoom);
        const b = elBox({ ...el, points: pts });
        this.commit([{ ...el, points: pts.length === 1 ? [[0, 0], [0.5, 0.5]] : pts, w: b.w, h: b.h }]);
        this.commitHistory();
        break;
      }
      case "erase": {
        const ids = [...d.ids];
        this.erasing.clear();
        if (ids.length) this.change(ids.map((id) => ({ ...this.els.get(id)!, isDeleted: true })));
        this.requestRender();
        break;
      }
      case "move":
      case "resize":
        this.commitHistory();
        break;
      case "marquee":
        this.requestRender();
        break;
      case "pan":
        this.updateCursor();
        break;
    }
  };

  private cancelDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === "create" || d.kind === "draw") {
      const el = this.els.get(d.id);
      if (el) this.commit([{ ...el, isDeleted: true }]);
      this.pending.delete(d.id);
    }
    this.commitHistory();
  }

  private eraseAlong(a: Pt, b: Pt) {
    const tol = 8 / this.cam.zoom;
    const d = this.drag as Extract<Drag, { kind: "erase" }>;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (tol / 2)));
    for (let i = 0; i <= steps; i++) {
      const p: Pt = [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps];
      const hit = this.hitAt(p);
      if (hit && !d.ids.has(hit.id)) {
        for (const id of this.expandGroups([hit.id])) {
          d.ids.add(id);
          this.erasing.add(id);
        }
      }
    }
    this.requestRender();
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const screen = this.eventScreen(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 4 : 1));
      this.zoomAt(screen[0], screen[1], this.cam.zoom * factor);
      return;
    }
    const mult = e.deltaMode === 1 ? 20 : 1;
    let dx = e.deltaX * mult, dy = e.deltaY * mult;
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    this.setCam(this.cam.x + dx / this.cam.zoom, this.cam.y + dy / this.cam.zoom);
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (!this.state.canEdit || (this.state.tool !== "select" && this.state.tool !== "text")) return;
    const p = this.toScene(...this.eventScreen(e));
    const hit = this.hitAt(p);
    if (hit && (hit.type === "text" || hasLabel(hit))) {
      this.startEditing(hit.id);
      return;
    }
    if (hit && hit.type === "frame") {
      const name = prompt("프레임 이름", hit.name || "");
      if (name !== null) this.change([{ ...hit, name: name.slice(0, 80) }]);
      return;
    }
    if (hit && (hit.type === "arrow" || hit.type === "line")) return;
    if (!hit || hit.type === "frame") {
      const style = this.state.style;
      const el = makeElement("text", { x: p[0], y: p[1] - (style.fontSize * LINE_HEIGHT) / 2, z: ++this.maxZ }, style);
      this.commit([fitText(el)]);
      this.startEditing(el.id, true);
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const screen = this.eventScreen(e);
    const p = this.toScene(...screen);
    this.lastScene = p;
    const hit = this.hitAt(p);
    if (hit && !this.state.selectedIds.includes(hit.id)) this.select(this.expandGroups([hit.id]));
    if (!hit) this.select([]);
    const r = this.host.getBoundingClientRect();
    this.setState({ menu: { x: e.clientX - r.left, y: e.clientY - r.top } });
  };

  private onDrop = (e: DragEvent) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    const p = this.toScene(...this.eventScreen(e));
    files.forEach((f, i) => {
      if (f.type.startsWith("image/")) this.insertImage(f, [p[0] + i * 30, p[1] + i * 30]);
      else if (f.name.endsWith(".json")) f.text().then((t) => this.importJSON(t));
    });
  };

  private updateHoverCursor(screen: Pt, p: Pt) {
    if (this.state.tool !== "select" || this.spaceDown) return;
    const ph = this.pointHandleAt(screen);
    if (ph !== null) {
      this.canvas.style.cursor = "pointer";
      return;
    }
    const h = this.handleAt(screen);
    if (h) {
      this.canvas.style.cursor = HANDLE_CURSORS[h];
      return;
    }
    const hit = this.hitAt(p);
    this.canvas.style.cursor = hit && this.state.canEdit ? "move" : "default";
  }
  private updateCursor() {
    if (!this.canvas) return;
    const t = this.state.tool;
    let c = "crosshair";
    if (this.drag?.kind === "pan") c = "grabbing";
    else if (this.spaceDown || t === "hand") c = "grab";
    else if (t === "select") c = "default";
    else if (t === "text") c = "text";
    else if (t === "eraser") c = "cell";
    this.canvas.style.cursor = c;
  }

  // =====================================================================
  // keyboard & clipboard
  // =====================================================================
  private isTyping(e: Event) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }
  private onBlur = () => {
    this.spaceDown = false;
    this.updateCursor();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") {
      this.spaceDown = false;
      this.updateCursor();
    }
  };
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (e.key === " " && !this.spaceDown) {
      this.spaceDown = true;
      this.updateCursor();
      e.preventDefault();
      return;
    }
    if (mod && k === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && k === "y") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod && k === "a") {
      e.preventDefault();
      this.setTool("select");
      this.select(this.live().map((x) => x.id));
      return;
    }
    if (mod && k === "d") {
      e.preventDefault();
      this.duplicate();
      return;
    }
    if (mod && k === "g") {
      e.preventDefault();
      if (e.shiftKey) this.ungroup();
      else this.group();
      return;
    }
    if (mod && (e.key === "]" || e.key === "}")) {
      e.preventDefault();
      this.reorder(e.shiftKey ? "front" : "forward");
      return;
    }
    if (mod && (e.key === "[" || e.key === "{")) {
      e.preventDefault();
      this.reorder(e.shiftKey ? "back" : "backward");
      return;
    }
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      this.zoomBy(1.2);
      return;
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      this.zoomBy(1 / 1.2);
      return;
    }
    if (mod && e.key === "0") {
      e.preventDefault();
      this.resetZoom();
      return;
    }
    if (e.shiftKey && (e.key === "!" || e.code === "Digit1")) {
      this.zoomToFit();
      return;
    }
    if (e.shiftKey && (e.key === "@" || e.code === "Digit2")) {
      this.zoomToFit(this.selected());
      return;
    }
    if (mod && k === "'") {
      e.preventDefault();
      this.setState({ grid: !this.state.grid });
      this.requestRender();
      return;
    }
    if (mod) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    if (e.key === "Escape") {
      this.cancelDrag();
      this.select([]);
      this.setState({ menu: null });
      this.setTool("select");
      return;
    }
    if (e.key === "Enter") {
      const s = this.selected();
      if (s.length === 1 && (s[0].type === "text" || hasLabel(s[0]))) {
        e.preventDefault();
        this.startEditing(s[0].id);
      }
      return;
    }
    if (e.key.startsWith("Arrow")) {
      const s = this.selected();
      if (!s.length || !this.state.canEdit) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const moved = s.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
      this.commit(moved);
      this.commit(this.arrowsBoundTo(new Set(s.map((x) => x.id))).map((id) => this.rebind(this.els.get(id)!)));
      this.commitHistory();
      return;
    }
    if (k === "q") {
      this.setState({ toolLock: !this.state.toolLock });
      return;
    }
    if (e.shiftKey || e.altKey) return;
    const tool = TOOL_KEYS[k];
    if (tool) this.setTool(tool);
  };

  private clipboardPayload(): string | null {
    const sel = this.selected();
    if (!sel.length) return null;
    return JSON.stringify({ type: CLIPBOARD_TAG, elements: sel });
  }
  private onCopy = (e: ClipboardEvent) => {
    if (this.isTyping(e) || this.state.editingId) return;
    const data = this.clipboardPayload();
    if (!data) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", data);
  };
  private onCut = (e: ClipboardEvent) => {
    if (this.isTyping(e) || this.state.editingId || !this.state.canEdit) return;
    const data = this.clipboardPayload();
    if (!data) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", data);
    this.deleteSelected();
  };
  private onPaste = (e: ClipboardEvent) => {
    if (this.isTyping(e) || this.state.editingId || !this.state.canEdit) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      files.forEach((f) => this.insertImage(f, this.lastScene));
      return;
    }
    const text = e.clipboardData?.getData("text/plain");
    if (text) {
      e.preventDefault();
      this.pasteText(text);
    }
  };
  async copySelection() {
    const data = this.clipboardPayload();
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data);
      this.toast("복사했어요");
    } catch {
      this.toast("클립보드에 접근할 수 없어요");
    }
  }
  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) this.pasteText(text);
    } catch {
      this.toast("Ctrl+V 로 붙여넣어 주세요");
    }
  }
  private pasteText(text: string) {
    try {
      const data = JSON.parse(text);
      if (data?.type === CLIPBOARD_TAG && Array.isArray(data.elements)) {
        this.insertElements(data.elements as El[], this.lastScene);
        return;
      }
      if (data?.type === "inkboard" && Array.isArray(data.elements)) {
        this.insertElements(data.elements as El[], this.lastScene);
        return;
      }
    } catch {
      /* plain text */
    }
    const style = this.state.style;
    const el = fitText(
      makeElement("text", { x: this.lastScene[0], y: this.lastScene[1], text: text.slice(0, 20000), z: ++this.maxZ }, style),
    );
    this.change([el]);
    this.select([el.id]);
  }

  /** Clone elements with fresh ids (keeping groups and arrow bindings inside the set). */
  private cloneElements(src: El[], dx: number, dy: number): El[] {
    const idMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    for (const e of src) idMap.set(e.id, randomId());
    const base = this.maxZ;
    const sorted = [...src].sort((a, b) => a.z - b.z);
    return sorted.map((e, i) => {
      const n: El = {
        ...e,
        id: idMap.get(e.id)!,
        x: e.x + dx,
        y: e.y + dy,
        seed: randomSeed(),
        version: 0,
        z: e.type === "frame" ? --this.minZ : base + i + 1,
        isDeleted: false,
      };
      if (e.groupId) {
        if (!groupMap.has(e.groupId)) groupMap.set(e.groupId, randomId());
        n.groupId = groupMap.get(e.groupId);
      }
      if (e.startBind) n.startBind = idMap.get(e.startBind) ?? null;
      if (e.endBind) n.endBind = idMap.get(e.endBind) ?? null;
      this.maxZ = Math.max(this.maxZ, n.z);
      return n;
    });
  }

  insertElements(src: El[], at?: Pt) {
    if (!this.state.canEdit) return;
    const valid = src.filter((e) => e && typeof e.id === "string" && typeof e.type === "string" && !e.isDeleted);
    if (!valid.length) return;
    const b = unionBox(valid.map(elBox))!;
    const [cx, cy] = at ?? this.toScene(this.width / 2, this.height / 2);
    const clones = this.cloneElements(valid, cx - (b.x + b.w / 2), cy - (b.y + b.h / 2));
    this.change(clones);
    this.setTool("select");
    this.select(clones.map((c) => c.id));
  }

  importJSON(text: string) {
    try {
      const data = JSON.parse(text);
      const els = Array.isArray(data) ? data : data.elements;
      if (!Array.isArray(els)) throw new Error();
      this.insertElements(els);
    } catch {
      this.toast("올바른 보드 파일이 아니에요");
    }
  }

  // =====================================================================
  // actions
  // =====================================================================
  deleteSelected() {
    if (!this.state.canEdit) return;
    const sel = this.selected();
    if (!sel.length) return;
    const ids = new Set(sel.map((s) => s.id));
    const changes: El[] = sel.map((e) => ({ ...e, isDeleted: true }));
    // detach arrows bound to deleted shapes
    for (const id of this.arrowsBoundTo(ids)) {
      const a = this.els.get(id)!;
      changes.push({
        ...a,
        startBind: a.startBind && ids.has(a.startBind) ? null : a.startBind,
        endBind: a.endBind && ids.has(a.endBind) ? null : a.endBind,
      });
    }
    this.change(changes);
    this.select([]);
  }
  duplicate() {
    const sel = this.selected();
    if (!sel.length || !this.state.canEdit) return;
    const off = 20;
    const clones = this.cloneElements(sel, off, off);
    this.change(clones);
    this.select(clones.map((c) => c.id));
  }
  group() {
    const sel = this.selected();
    if (sel.length < 2) return;
    const g = randomId();
    this.change(sel.map((e) => ({ ...e, groupId: g })));
  }
  ungroup() {
    const sel = this.selected().filter((e) => e.groupId);
    if (!sel.length) return;
    this.change(sel.map((e) => ({ ...e, groupId: null })));
  }
  toggleLock() {
    const sel = this.selected();
    if (!sel.length) return;
    const lock = !sel.every((e) => e.locked);
    this.change(sel.map((e) => ({ ...e, locked: lock })));
    if (lock) this.select([]);
  }
  unlockAll() {
    const locked = this.live().filter((e) => e.locked);
    if (locked.length) this.change(locked.map((e) => ({ ...e, locked: false })));
  }
  reorder(dir: "front" | "back" | "forward" | "backward") {
    const sel = this.selected();
    if (!sel.length || !this.state.canEdit) return;
    const ids = new Set(sel.map((s) => s.id));
    const list = this.live();
    let changes: El[] = [];
    if (dir === "front") changes = sel.sort((a, b) => a.z - b.z).map((e) => ({ ...e, z: ++this.maxZ }));
    else if (dir === "back") changes = sel.sort((a, b) => b.z - a.z).map((e) => ({ ...e, z: --this.minZ }));
    else {
      // swap past the nearest overlapping non-selected element
      const box = unionBox(sel.map(elBox))!;
      const others = list.filter((e) => !ids.has(e.id) && boxesIntersect(elBox(e), box));
      const maxSel = Math.max(...sel.map((e) => e.z));
      const minSel = Math.min(...sel.map((e) => e.z));
      if (dir === "forward") {
        const next = others.filter((e) => e.z > maxSel).sort((a, b) => a.z - b.z)[0];
        if (!next) return;
        const after = list.filter((e) => e.z > next.z)[0];
        const top = after ? (next.z + after.z) / 2 : next.z + 1;
        changes = sel.sort((a, b) => a.z - b.z).map((e, i, arr) => ({ ...e, z: next.z + ((top - next.z) * (i + 1)) / (arr.length + 1) }));
      } else {
        const prev = others.filter((e) => e.z < minSel).sort((a, b) => b.z - a.z)[0];
        if (!prev) return;
        const before = [...list].reverse().find((e) => e.z < prev.z);
        const bottom = before ? (prev.z + before.z) / 2 : prev.z - 1;
        changes = sel.sort((a, b) => a.z - b.z).map((e, i, arr) => ({ ...e, z: bottom + ((prev.z - bottom) * (i + 1)) / (arr.length + 1) }));
      }
    }
    this.change(changes);
  }
  align(kind: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    const sel = this.selected();
    if (sel.length < 2) return;
    const B = unionBox(sel.map(elBox))!;
    const changes = sel.map((e) => {
      const b = elBox(e);
      let dx = 0, dy = 0;
      if (kind === "left") dx = B.x - b.x;
      if (kind === "right") dx = B.x + B.w - (b.x + b.w);
      if (kind === "hcenter") dx = B.x + B.w / 2 - (b.x + b.w / 2);
      if (kind === "top") dy = B.y - b.y;
      if (kind === "bottom") dy = B.y + B.h - (b.y + b.h);
      if (kind === "vcenter") dy = B.y + B.h / 2 - (b.y + b.h / 2);
      return { ...e, x: e.x + dx, y: e.y + dy };
    });
    this.commit(changes);
    this.commit(this.arrowsBoundTo(new Set(sel.map((s) => s.id))).map((id) => this.rebind(this.els.get(id)!)));
    this.commitHistory();
  }
  distribute(axis: "h" | "v") {
    const sel = this.selected();
    if (sel.length < 3) return;
    const boxes = sel.map((e) => ({ e, b: elBox(e) }));
    boxes.sort((a, b) => (axis === "h" ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = boxes[0].b, last = boxes[boxes.length - 1].b;
    const total = boxes.reduce((s, x) => s + (axis === "h" ? x.b.w : x.b.h), 0);
    const span = axis === "h" ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (boxes.length - 1);
    let cur = axis === "h" ? first.x : first.y;
    const changes = boxes.map(({ e, b }) => {
      const delta = cur - (axis === "h" ? b.x : b.y);
      cur += (axis === "h" ? b.w : b.h) + gap;
      return axis === "h" ? { ...e, x: e.x + delta } : { ...e, y: e.y + delta };
    });
    this.commit(changes);
    this.commit(this.arrowsBoundTo(new Set(sel.map((s) => s.id))).map((id) => this.rebind(this.els.get(id)!)));
    this.commitHistory();
  }
  clearBoard() {
    const all = this.live();
    if (all.length) this.change(all.map((e) => ({ ...e, isDeleted: true })));
    this.select([]);
  }

  // =====================================================================
  // text editing
  // =====================================================================
  startEditing(id: string, isNew = false) {
    const el = this.els.get(id);
    if (!el || !this.state.canEdit) return;
    this.editingNew = isNew;
    this.select([id]);
    this.setState({ editingId: id });
    const ta = this.textarea;
    ta.value = el.text ?? "";
    ta.style.display = "block";
    this.positionTextarea();
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    this.requestRender();
  }
  private positionTextarea() {
    const id = this.state.editingId;
    if (!id || !this.textarea) return;
    const el = this.els.get(id);
    if (!el) return;
    const z = this.cam.zoom;
    const size = el.fontSize ?? 20;
    const ta = this.textarea;
    const s = ta.style;
    s.font = fontString(size * z, el.fontFamily ?? "hand");
    s.lineHeight = String(LINE_HEIGHT);
    s.color = el.strokeColor;
    s.textAlign = el.textAlign ?? "left";
    if (el.type === "text") {
      const [x, y] = this.toScreen(el.x, el.y);
      s.left = `${x}px`;
      s.top = `${y}px`;
      s.width = `${(el.w + size) * z}px`;
      s.height = `${el.h * z + 4}px`;
      s.whiteSpace = "pre";
    } else {
      const lines = labelLines({ ...el, text: ta.value || " " });
      const th = lines.length * size * LINE_HEIGHT;
      const [x, y] = this.toScreen(el.x + LABEL_PAD, el.y + (el.h - th) / 2);
      s.left = `${x}px`;
      s.top = `${y}px`;
      s.width = `${(el.w - LABEL_PAD * 2) * z}px`;
      s.height = `${th * z + 4}px`;
      s.whiteSpace = "pre-wrap";
    }
  }
  private onTextInput = () => {
    const id = this.state.editingId;
    const el = id && this.els.get(id);
    if (!el) return;
    this.commit([fitText({ ...el, text: this.textarea.value })]);
    this.positionTextarea();
  };
  private onTextKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      this.finishEditing();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = this.textarea;
      const p = ta.selectionStart;
      ta.value = ta.value.slice(0, p) + "  " + ta.value.slice(ta.selectionEnd);
      ta.setSelectionRange(p + 2, p + 2);
      this.onTextInput();
    }
  };
  finishEditing() {
    const id = this.state.editingId;
    if (!id) return;
    this.setState({ editingId: null });
    this.textarea.style.display = "none";
    this.textarea.blur();
    const el = this.els.get(id);
    if (el && el.type === "text" && !(el.text ?? "").trim()) {
      this.commit([{ ...el, isDeleted: true }]);
      if (this.editingNew) this.pending.delete(id);
      this.select([]);
    }
    this.editingNew = false;
    this.commitHistory();
    this.requestRender();
  }

  // =====================================================================
  // rendering
  // =====================================================================
  requestRender() {
    if (!this.raf && this.canvas) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render() {
    const ctx = this.ctx;
    const { zoom } = this.cam;
    const dpr = this.dpr;
    const now = performance.now();
    let animate = false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fbfbfa";
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.state.grid) drawGrid(ctx, this.cam, this.width, this.height, "#cfd4da");

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -this.cam.x * zoom * dpr, -this.cam.y * zoom * dpr);
    const view = this.viewBox();
    const opts = { zoom, editingId: this.state.editingId, getImage: this.getImage, dark: this.state.theme === "dark" };
    for (const el of this.live()) {
      const b = elBox(el);
      const pad = el.strokeWidth * 4 + 30;
      if (b.x > view.x + view.w + pad || b.x + b.w < view.x - pad || b.y > view.y + view.h + pad || b.y + b.h < view.y - pad) continue;
      drawElement(ctx, this.rc, el, { ...opts, faded: this.erasing.has(el.id) });
    }

    const lw = 1 / zoom;
    const accent = "#6965db";

    // remote selections
    for (const r of this.remotes.values()) {
      if (!r.selection.length) continue;
      const b = unionBox(r.selection.map((id) => this.els.get(id)).filter((e): e is El => !!e && !e.isDeleted).map(elBox));
      if (!b) continue;
      ctx.strokeStyle = r.peer.color;
      ctx.lineWidth = 2 * lw;
      ctx.setLineDash([]);
      const pad = 5 * lw;
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    }

    // bind highlight
    if (this.hoverBind) {
      const t = this.els.get(this.hoverBind);
      if (t) {
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 6 * lw;
        const b = elBox(t);
        ctx.strokeRect(b.x - 4 * lw, b.y - 4 * lw, b.w + 8 * lw, b.h + 8 * lw);
        ctx.globalAlpha = 1;
      }
    }

    // selection
    const sel = this.selected();
    if (sel.length && !this.state.editingId) {
      const lin = this.singleLinear();
      if (lin) {
        const pts = absPoints(lin);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5 * lw;
        for (let i = 0; i < pts.length; i++) {
          ctx.beginPath();
          ctx.arc(pts[i][0], pts[i][1], 5 * lw, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        if (this.state.canEdit) {
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.45;
          for (let i = 0; i < pts.length - 1; i++) {
            ctx.beginPath();
            ctx.arc((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2, 3.5 * lw, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.strokeStyle = accent;
        ctx.lineWidth = lw;
        if (sel.length > 1) {
          ctx.setLineDash([4 * lw, 4 * lw]);
          for (const e of sel) {
            const b = elBox(e);
            ctx.strokeRect(b.x, b.y, b.w, b.h);
          }
          ctx.setLineDash([]);
        }
        const b0 = this.selectionBox()!;
        const pad = 6 * lw;
        const b = { x: b0.x - pad, y: b0.y - pad, w: b0.w + pad * 2, h: b0.h + pad * 2 };
        ctx.lineWidth = 1.5 * lw;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        if (this.state.canEdit) {
          ctx.fillStyle = "#fff";
          const hs = 8 * lw;
          for (const h of HANDLES) {
            if (sel.length === 1 && sel[0].type === "text" && (h === "n" || h === "s")) continue;
            const [hx, hy] = handlePos(b, h);
            ctx.beginPath();
            ctx.roundRect(hx - hs / 2, hy - hs / 2, hs, hs, 2 * lw);
            ctx.fill();
            ctx.stroke();
          }
        }
        if (sel.some((e) => e.locked)) {
          ctx.fillStyle = accent;
          ctx.font = fontString(12 * lw, "sans");
          ctx.fillText("🔒", b.x + b.w + 4 * lw, b.y);
        }
      }
    }

    // marquee
    if (this.drag?.kind === "marquee") {
      const b = normBox(this.drag.x0, this.drag.y0, this.drag.x1, this.drag.y1);
      ctx.fillStyle = "rgba(105,101,219,0.08)";
      ctx.strokeStyle = accent;
      ctx.lineWidth = lw;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    // smart guides
    if (this.guides.x.length || this.guides.y.length) {
      ctx.strokeStyle = "#f03e3e";
      ctx.lineWidth = lw;
      ctx.setLineDash([3 * lw, 3 * lw]);
      for (const gx of this.guides.x) {
        ctx.beginPath();
        ctx.moveTo(gx, view.y);
        ctx.lineTo(gx, view.y + view.h);
        ctx.stroke();
      }
      for (const gy of this.guides.y) {
        ctx.beginPath();
        ctx.moveTo(view.x, gy);
        ctx.lineTo(view.x + view.w, gy);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ---- screen space: lasers & cursors ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const drawLaser = (strokes: { x: number; y: number; t: number }[][], color: string) => {
      for (let si = strokes.length - 1; si >= 0; si--) {
        const s = strokes[si];
        while (s.length && now - s[0].t > LASER_TTL) s.shift();
        if (!s.length) {
          strokes.splice(si, 1);
          continue;
        }
        animate = true;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = 1; i < s.length; i++) {
          const a = this.toScreen(s[i - 1].x, s[i - 1].y);
          const b = this.toScreen(s[i].x, s[i].y);
          const life = 1 - (now - s[i].t) / LASER_TTL;
          ctx.strokeStyle = color;
          ctx.globalAlpha = Math.max(0, life);
          ctx.lineWidth = 2 + 4 * life;
          ctx.shadowColor = color;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    };
    drawLaser(this.laser, "#ff2d55");
    for (const r of this.remotes.values()) {
      drawLaser(r.laser, r.peer.color);
      if (!r.hasCursor) continue;
      r.dx += (r.x - r.dx) * 0.35;
      r.dy += (r.y - r.dy) * 0.35;
      if (Math.abs(r.x - r.dx) > 0.2 || Math.abs(r.y - r.dy) > 0.2) animate = true;
      const [sx, sy] = this.toScreen(r.dx, r.dy);
      if (sx < -50 || sy < -50 || sx > this.width + 50 || sy > this.height + 50) continue;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.fillStyle = r.peer.color;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 16);
      ctx.lineTo(4.5, 12);
      ctx.lineTo(8, 19);
      ctx.lineTo(10.5, 18);
      ctx.lineTo(7.2, 11);
      ctx.lineTo(12.5, 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = fontString(12, "sans");
      const tw = ctx.measureText(r.peer.name).width;
      ctx.beginPath();
      ctx.roundRect(12, 18, tw + 12, 20, 6);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(r.peer.name, 18, 28.5);
      ctx.restore();
    }

    if (animate) this.requestRender();
  }

  // =====================================================================
  // export
  // =====================================================================
  private async renderTo(els: El[], opts: { scale: number; background: boolean; pad: number; maxW?: number; maxH?: number }) {
    const b = unionBox(els.map(elBox));
    if (!b) return null;
    const pad = opts.pad;
    let scale = opts.scale;
    const w = b.w + pad * 2, h = b.h + pad * 2;
    if (opts.maxW && opts.maxH) scale = Math.min(opts.maxW / w, opts.maxH / h, 2);
    scale = Math.min(scale, 8192 / w, 8192 / h);
    // make sure images are loaded
    await Promise.all(
      els.filter((e) => e.assetId).map((e) => {
        const img = this.getImage(e.assetId!);
        return img && !img.complete ? img.decode().catch(() => {}) : null;
      }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(opts.maxW ?? w * scale));
    canvas.height = Math.max(1, Math.round(opts.maxH ?? h * scale));
    const ctx = canvas.getContext("2d")!;
    if (opts.background) {
      ctx.fillStyle = "#fbfbfa";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const ox = (canvas.width - w * scale) / 2;
    const oy = (canvas.height - h * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, ox + (pad - b.x) * scale, oy + (pad - b.y) * scale);
    const rc = rough.canvas(canvas);
    for (const el of [...els].sort((a, c) => a.z - c.z)) drawElement(ctx, rc, el, { zoom: 1, getImage: this.getImage });
    return canvas;
  }

  async exportPNG(opts: { selectionOnly: boolean; background: boolean; scale: number }): Promise<Blob | null> {
    const sel = this.selected();
    let els = opts.selectionOnly && sel.length ? sel : this.live();
    // exporting a frame exports its contents too
    if (opts.selectionOnly && sel.length === 1 && sel[0].type === "frame") {
      const fb = elBox(sel[0]);
      els = this.live().filter((e) => e.id === sel[0].id || boxContains(fb, elBox(e)));
    }
    const c = await this.renderTo(els, { scale: opts.scale, background: opts.background, pad: 24 });
    if (!c) return null;
    return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
  }

  async thumbnail(): Promise<string | null> {
    const els = this.live();
    if (!els.length) return null;
    const c = await this.renderTo(els, { scale: 1, background: true, pad: 30, maxW: 480, maxH: 300 });
    return c ? c.toDataURL("image/webp", 0.75) : null;
  }

  exportJSON(): string {
    return JSON.stringify({ type: "inkboard", version: 1, elements: this.live() }, null, 2);
  }

  /** Used by templates: add elements as one undoable step. */
  addElements(els: El[]) {
    const base = this.maxZ;
    this.change(els.map((e, i) => ({ ...e, z: e.type === "frame" ? --this.minZ : base + i + 1 })));
  }

  forget(id: string) {
    forgetCache(id);
  }
}

async function downscaleImage(file: File, max: number): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const { width, height } = bmp;
  const s = Math.min(1, max / Math.max(width, height));
  if ((file.type === "image/gif" || file.type === "image/svg+xml") && file.size < 1_500_000) {
    return { blob: file, w: width, h: height };
  }
  const w = Math.round(width * s), h = Math.round(height * s);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/webp", 0.85));
  if (s === 1 && file.size < blob.size && file.size < 1_500_000) return { blob: file, w, h };
  return { blob, w, h };
}
