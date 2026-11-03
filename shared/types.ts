// Types shared between the browser app and the Worker / Durable Object.

export type ElType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "line"
  | "arrow"
  | "freedraw"
  | "text"
  | "sticky"
  | "image"
  | "frame";

export type FillStyle = "none" | "hachure" | "cross-hatch" | "solid";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type FontFamily = "hand" | "sans" | "mono";
export type TextAlign = "left" | "center" | "right";
export type Arrowhead = "none" | "arrow" | "triangle" | "dot" | "bar";

/** A single thing on the board. Flat shape with optional per-type fields. */
export interface El {
  id: string;
  type: ElType;
  x: number;
  y: number;
  w: number;
  h: number;
  strokeColor: string;
  fillColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  /** 0 = clean, 1 = sketchy, 2 = very sketchy */
  roughness: number;
  /** 0..100 */
  opacity: number;
  roundness?: boolean;
  seed: number;
  /** Incremented on every change; higher version wins when merging. */
  version: number;
  /** Random tie-breaker for equal versions. */
  nonce: number;
  /** Paint order (higher = on top). */
  z: number;
  isDeleted?: boolean;
  groupId?: string | null;
  locked?: boolean;

  // text / labels
  text?: string;
  fontSize?: number;
  fontFamily?: FontFamily;
  textAlign?: TextAlign;
  /** text element whose `text` is LaTeX source, rendered as a formula */
  math?: boolean;

  // line / arrow / freedraw — points are relative to (x, y)
  points?: [number, number][];
  curved?: boolean;
  startArrow?: Arrowhead;
  endArrow?: Arrowhead;
  startBind?: string | null;
  endBind?: string | null;

  // image
  assetId?: string;

  // frame
  name?: string;

  link?: string;
}

export interface Peer {
  cid: string; // connection id
  uid: string;
  name: string;
  color: string;
  avatar?: string | null;
  canEdit: boolean;
}

export type ClientMsg =
  | { t: "upsert"; elements: El[] }
  | { t: "cursor"; x: number; y: number }
  | { t: "laser"; x: number; y: number; start?: boolean }
  | { t: "selection"; ids: string[] }
  | { t: "ping" };

export type ServerMsg =
  | { t: "init"; elements: El[]; self: Peer; peers: Peer[] }
  | { t: "upsert"; elements: El[]; from?: string }
  | { t: "join"; peer: Peer }
  | { t: "leave"; cid: string }
  | { t: "cursor"; cid: string; x: number; y: number }
  | { t: "laser"; cid: string; x: number; y: number; start?: boolean }
  | { t: "selection"; cid: string; ids: string[] }
  | { t: "pong" }
  | { t: "error"; message: string }
  | { t: "deleted" };

export type ShareMode = "private" | "view" | "edit";

export interface User {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  provider: string;
}

export interface BoardSummary {
  id: string;
  title: string;
  thumbnail: string | null;
  share: ShareMode;
  updatedAt: number;
  ownerName?: string;
}

export interface BoardMeta {
  id: string;
  title: string;
  share: ShareMode;
  isOwner: boolean;
  canEdit: boolean;
  owner: { name: string; avatar: string | null };
}

/** Merge rule used by both client and server. Returns true if `incoming` should replace `existing`. */
export function shouldReplace(existing: El | undefined, incoming: El): boolean {
  if (!existing) return true;
  if (incoming.version > existing.version) return true;
  if (incoming.version === existing.version && incoming.nonce < existing.nonce) return true;
  return false;
}

export const PEER_COLORS = [
  "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5",
  "#0c8599", "#e8590c", "#6741d9", "#c2255c", "#5c940d",
];
