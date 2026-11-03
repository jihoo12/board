import type { El } from "../../shared/types";

export type Pt = [number, number];
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const isLinear = (el: El) => el.type === "line" || el.type === "arrow" || el.type === "freedraw";
export const isBindable = (el: El) =>
  el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond" || el.type === "sticky" ||
  el.type === "image" || el.type === "text";
export const hasLabel = (el: El) =>
  el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond" || el.type === "sticky";

export function absPoints(el: El): Pt[] {
  return (el.points || []).map(([px, py]) => [el.x + px, el.y + py]);
}

export function elBox(el: El): Box {
  if (el.points && el.points.length) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [px, py] of el.points) {
      if (px < x1) x1 = px;
      if (py < y1) y1 = py;
      if (px > x2) x2 = px;
      if (py > y2) y2 = py;
    }
    return { x: el.x + x1, y: el.y + y1, w: x2 - x1, h: y2 - y1 };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function boxesIntersect(a: Box, b: Box) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function boxContains(outer: Box, inner: Box) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function normBox(x0: number, y0: number, x1: number, y1: number): Box {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function distToPolyline(px: number, py: number, pts: Pt[]) {
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]);
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    d = Math.min(d, distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  return d;
}

/** Does point (px,py) hit the element? `tol` is in scene units. */
export function hitTest(el: El, px: number, py: number, tol: number): boolean {
  if (isLinear(el)) {
    const b = elBox(el);
    const pad = tol + el.strokeWidth * 2;
    if (px < b.x - pad || px > b.x + b.w + pad || py < b.y - pad || py > b.y + b.h + pad) return false;
    return distToPolyline(px, py, absPoints(el)) <= pad;
  }
  const { x, y, w, h } = el;
  if (el.type === "ellipse") {
    const rx = w / 2 + tol, ry = h / 2 + tol;
    const dx = px - (x + w / 2), dy = py - (y + h / 2);
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  }
  if (el.type === "diamond") {
    const hw = w / 2 + tol, hh = h / 2 + tol;
    return Math.abs(px - (x + w / 2)) / hw + Math.abs(py - (y + h / 2)) / hh <= 1;
  }
  if (el.type === "frame") {
    // frames are hit on their title bar or border, so you can marquee-select inside them
    if (px >= x && px <= x + w && py >= y - tol * 4 && py <= y + tol) return true;
    const inOuter = px >= x - tol && px <= x + w + tol && py >= y - tol && py <= y + h + tol;
    const inInner = px >= x + tol && px <= x + w - tol && py >= y + tol && py <= y + h - tol;
    return inOuter && !inInner;
  }
  return px >= x - tol && px <= x + w + tol && py >= y - tol && py <= y + h + tol;
}

export function center(el: El): Pt {
  const b = elBox(el);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** Point on the outline of `el` along the ray from its center towards `toward`, pushed out by `gap`. */
export function borderPoint(el: El, toward: Pt, gap = 6): Pt {
  const [cx, cy] = center(el);
  const hw = Math.max(el.w / 2, 1), hh = Math.max(el.h / 2, 1);
  const dx = toward[0] - cx, dy = toward[1] - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return [cx, cy];
  let t: number;
  if (el.type === "ellipse") t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else if (el.type === "diamond") t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  const len = Math.hypot(dx, dy);
  const bx = cx + dx * t, by = cy + dy * t;
  return [bx + (dx / len) * gap, by + (dy / len) * gap];
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function handlePos(b: Box, h: Handle): Pt {
  const xs = { w: b.x, c: b.x + b.w / 2, e: b.x + b.w };
  const ys = { n: b.y, c: b.y + b.h / 2, s: b.y + b.h };
  const hx = h.includes("w") ? xs.w : h.includes("e") ? xs.e : xs.c;
  const hy = h.includes("n") ? ys.n : h.includes("s") ? ys.s : ys.c;
  return [hx, hy];
}

export const HANDLE_CURSORS: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

/** Simplify a polyline (Ramer–Douglas–Peucker) – used to keep freedraw strokes small. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const l = simplify(pts.slice(0, idx + 1), eps);
    const r = simplify(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}
