import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Drawable, Options } from "roughjs/bin/core";
import { getStroke } from "perfect-freehand";
import type { Arrowhead, El } from "../../shared/types";
import { fontString, labelLines, LABEL_PAD, LINE_HEIGHT } from "./elements";
import type { Pt } from "./geometry";
import { mathFailed, mathImage, mathLayout } from "./math";

const gen = rough.generator();

interface CacheEntry {
  key: string;
  points?: El["points"];
  drawables?: Drawable[];
  path?: Path2D;
}
const cache = new Map<string, CacheEntry>();

function shapeKey(el: El) {
  return [
    el.type, el.w, el.h, el.strokeColor, el.fillColor, el.fillStyle, el.strokeWidth, el.strokeStyle,
    el.roughness, el.seed, el.roundness, el.curved, el.startArrow, el.endArrow,
  ].join("|");
}

function roughOpts(el: El): Options {
  const sw = el.strokeWidth;
  const dash =
    el.strokeStyle === "dashed" ? [8 + sw * 2, 6 + sw * 2] : el.strokeStyle === "dotted" ? [1.5, 4 + sw * 2] : undefined;
  return {
    seed: el.seed || 1,
    roughness: el.roughness,
    bowing: el.roughness ? 1 : 0,
    stroke: el.strokeColor,
    strokeWidth: sw,
    fill: el.fillStyle !== "none" ? el.fillColor : undefined,
    fillStyle: el.fillStyle === "none" ? undefined : el.fillStyle,
    fillWeight: sw / 2,
    hachureGap: sw * 3 + 4,
    strokeLineDash: dash,
    disableMultiStroke: el.roughness === 0 || !!dash,
    disableMultiStrokeFill: el.roughness === 0,
    preserveVertices: el.roughness < 1,
  };
}

function roundedRectPath(w: number, h: number) {
  const r = Math.min(Math.abs(w), Math.abs(h)) * 0.18 > 24 ? 24 : Math.min(Math.abs(w), Math.abs(h)) * 0.18;
  return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
}

function arrowhead(kind: Arrowhead, tip: Pt, from: Pt, el: El, o: Options): Drawable[] {
  if (kind === "none") return [];
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const segLen = Math.hypot(tip[0] - from[0], tip[1] - from[1]);
  const size = Math.min(10 + el.strokeWidth * 3, segLen * 0.7 + 4);
  const opts: Options = { ...o, fill: undefined, strokeLineDash: undefined };
  const at = (a: number, s = size): Pt => [tip[0] - s * Math.cos(ang + a), tip[1] - s * Math.sin(ang + a)];
  switch (kind) {
    case "arrow": {
      const a = at(0.45), b = at(-0.45);
      return [gen.linearPath([a, tip, b], opts)];
    }
    case "triangle": {
      const a = at(0.42), b = at(-0.42);
      return [gen.polygon([tip, a, b], { ...opts, fill: el.strokeColor, fillStyle: "solid" })];
    }
    case "dot": {
      const d = size * 0.75;
      const c = at(0, d / 2);
      return [gen.circle(c[0], c[1], d, { ...opts, fill: el.strokeColor, fillStyle: "solid" })];
    }
    case "bar": {
      const p1: Pt = [tip[0] + (size / 2) * Math.cos(ang + Math.PI / 2), tip[1] + (size / 2) * Math.sin(ang + Math.PI / 2)];
      const p2: Pt = [tip[0] - (size / 2) * Math.cos(ang + Math.PI / 2), tip[1] - (size / 2) * Math.sin(ang + Math.PI / 2)];
      return [gen.line(p1[0], p1[1], p2[0], p2[1], opts)];
    }
  }
}

function buildDrawables(el: El): Drawable[] {
  const o = roughOpts(el);
  const { w, h } = el;
  switch (el.type) {
    case "rectangle":
      return [el.roundness ? gen.path(roundedRectPath(w, h), o) : gen.rectangle(0, 0, w, h, o)];
    case "ellipse":
      return [gen.ellipse(w / 2, h / 2, w, h, o)];
    case "diamond":
      return [gen.polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], o)];
    case "line":
    case "arrow": {
      const pts = (el.points || []) as Pt[];
      if (pts.length < 2) return [];
      const lo = { ...o, fill: undefined };
      const out: Drawable[] = [el.curved && pts.length > 2 ? gen.curve(pts, lo) : gen.linearPath(pts, lo)];
      if (el.type === "arrow") {
        out.push(...arrowhead(el.endArrow ?? "arrow", pts[pts.length - 1], pts[pts.length - 2], el, o));
        out.push(...arrowhead(el.startArrow ?? "none", pts[0], pts[1], el, o));
      }
      return out;
    }
    default:
      return [];
  }
}

function freedrawPath(el: El): Path2D {
  const pts = el.points || [];
  const stroke = getStroke(pts, {
    size: el.strokeWidth * 2.2 + 2,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: true,
    last: true,
  });
  const p = new Path2D();
  if (!stroke.length) return p;
  p.moveTo(stroke[0][0], stroke[0][1]);
  for (let i = 1; i < stroke.length; i++) {
    const [x0, y0] = stroke[i];
    const [x1, y1] = stroke[(i + 1) % stroke.length];
    p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  p.closePath();
  return p;
}

function cached(el: El): CacheEntry {
  const key = shapeKey(el);
  let c = cache.get(el.id);
  if (!c || c.key !== key || c.points !== el.points) {
    c = { key, points: el.points };
    if (el.type === "freedraw") c.path = freedrawPath(el);
    else c.drawables = buildDrawables(el);
    cache.set(el.id, c);
  }
  return c;
}

export function forgetCache(id: string) {
  cache.delete(id);
}

export interface RenderOpts {
  zoom: number;
  editingId?: string | null;
  getImage: (assetId: string) => HTMLImageElement | null;
  dark?: boolean;
  faded?: boolean;
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  w: number,
  el: El,
) {
  const size = el.fontSize ?? 20;
  const lh = size * LINE_HEIGHT;
  ctx.font = fontString(size, el.fontFamily ?? "hand");
  ctx.fillStyle = el.strokeColor;
  ctx.textBaseline = "middle";
  const align = el.textAlign ?? "left";
  ctx.textAlign = align;
  const tx = align === "left" ? x : align === "center" ? x + w / 2 : x + w;
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], tx, y + i * lh + lh / 2);
}

function drawMath(ctx: CanvasRenderingContext2D, el: El, editing: boolean) {
  const src = (el.text ?? "").trim();
  if (!src) {
    if (editing) {
      ctx.strokeStyle = "#adb5bd";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(0, 0, el.w, el.h);
      ctx.setLineDash([]);
    }
    return;
  }
  const layout = mathLayout(src);
  const img = mathImage(src, el.strokeColor);
  if (layout && img && img.complete && img.naturalWidth) {
    // contain: the stored box may come from before MathJax finished loading elsewhere
    const s = Math.min(el.w / layout.w, el.h / layout.h);
    const w = layout.w * s, h = layout.h * s;
    ctx.drawImage(img, (el.w - w) / 2, (el.h - h) / 2, w, h);
    return;
  }
  // placeholder while the formula engine loads (or if it failed): show the source
  const size = Math.max(8, Math.min(el.h * 0.6, 16));
  ctx.font = fontString(size, "mono");
  ctx.fillStyle = mathFailed() || layout?.error ? "#e03131" : "#868e96";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, el.w, el.h);
  ctx.clip();
  ctx.fillText(src.replace(/\s+/g, " "), 0, el.h / 2);
  ctx.restore();
}

export function drawElement(ctx: CanvasRenderingContext2D, rc: RoughCanvas, el: El, o: RenderOpts) {
  ctx.save();
  ctx.globalAlpha = (el.opacity ?? 100) / 100 * (o.faded ? 0.3 : 1);
  ctx.translate(el.x, el.y);

  switch (el.type) {
    case "sticky": {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = el.fillColor;
      ctx.beginPath();
      ctx.roundRect(0, 0, el.w, el.h, 4);
      ctx.fill();
      ctx.restore();
      // a little folded-tape accent
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(0, 0, el.w, 6);
      break;
    }
    case "frame": {
      ctx.fillStyle = el.fillColor;
      ctx.fillRect(0, 0, el.w, el.h);
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = 1 / o.zoom;
      ctx.strokeRect(0, 0, el.w, el.h);
      ctx.fillStyle = "#868e96";
      ctx.font = fontString(13 / o.zoom, "sans");
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(el.name || "프레임", 0, -5 / o.zoom);
      break;
    }
    case "image": {
      const img = el.assetId ? o.getImage(el.assetId) : null;
      if (img && img.complete && img.naturalWidth) {
        if (o.dark) ctx.filter = "invert(100%) hue-rotate(180deg)";
        ctx.drawImage(img, 0, 0, el.w, el.h);
        ctx.filter = "none";
      } else {
        ctx.fillStyle = "#e9ecef";
        ctx.fillRect(0, 0, el.w, el.h);
        ctx.fillStyle = "#adb5bd";
        ctx.font = fontString(14, "sans");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("이미지 불러오는 중…", el.w / 2, el.h / 2);
      }
      break;
    }
    case "freedraw": {
      const c = cached(el);
      ctx.fillStyle = el.strokeColor;
      ctx.fill(c.path!);
      break;
    }
    case "text":
      break;
    default: {
      const c = cached(el);
      for (const d of c.drawables!) rc.draw(d);
    }
  }

  // text
  if (el.type === "text" && el.math) {
    // formulas stay visible while editing – the source editor sits below as a live preview
    drawMath(ctx, el, o.editingId === el.id);
  } else if (o.editingId !== el.id) {
    if (el.type === "text" && el.text) {
      drawTextBlock(ctx, el.text.split("\n"), 0, 0, el.w, el);
    } else if ((el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond" || el.type === "sticky") && el.text) {
      const lines = labelLines(el);
      const lh = (el.fontSize ?? 20) * LINE_HEIGHT;
      const th = lines.length * lh;
      drawTextBlock(ctx, lines, LABEL_PAD, (el.h - th) / 2, el.w - LABEL_PAD * 2, el);
    }
  }
  ctx.restore();
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  cam: { x: number; y: number; zoom: number },
  width: number,
  height: number,
  color: string,
) {
  let step = 20;
  while (step * cam.zoom < 14) step *= 5;
  const s = step * cam.zoom;
  const ox = (((-cam.x * cam.zoom) % s) + s) % s;
  const oy = (((-cam.y * cam.zoom) % s) + s) % s;
  ctx.fillStyle = color;
  const r = Math.max(0.8, Math.min(1.5, cam.zoom));
  for (let x = ox; x < width; x += s) {
    for (let y = oy; y < height; y += s) {
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
  }
}
