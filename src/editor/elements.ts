import type { El, ElType, FontFamily } from "../../shared/types";
import { hasLabel } from "./geometry";

export const FONT_STACKS: Record<FontFamily, string> = {
  hand: '"Patrick Hand", "Gaegu", "Comic Sans MS", cursive',
  sans: '"Inter", "Noto Sans KR", system-ui, sans-serif',
  mono: '"JetBrains Mono", "D2Coding", ui-monospace, monospace',
};
export const LINE_HEIGHT = 1.3;
export const LABEL_PAD = 12;

export function fontString(size: number, family: FontFamily = "hand") {
  return `${size}px ${FONT_STACKS[family]}`;
}

export function randomId(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const b = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const x of b) s += chars[x % chars.length];
  return s;
}
export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")!;
  return measureCtx;
}

export function measureLines(lines: string[], size: number, family: FontFamily) {
  const ctx = mctx();
  ctx.font = fontString(size, family);
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  return { w: Math.ceil(w), h: Math.ceil(lines.length * size * LINE_HEIGHT) };
}

/** Greedy word-wrap that also breaks long words (needed for CJK text without spaces). */
export function wrapText(text: string, maxWidth: number, size: number, family: FontFamily): string[] {
  const ctx = mctx();
  ctx.font = fontString(size, family);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const token of para.split(/(\s+)/)) {
      if (!token) continue;
      if (ctx.measureText(line + token).width <= maxWidth) {
        line += token;
        continue;
      }
      if (/^\s+$/.test(token)) {
        out.push(line.trimEnd());
        line = "";
        continue;
      }
      if (line.trim()) {
        out.push(line.trimEnd());
        line = "";
      }
      if (ctx.measureText(token).width <= maxWidth) {
        line = token;
        continue;
      }
      // token too long by itself – break by characters
      for (const ch of token) {
        if (ctx.measureText(line + ch).width > maxWidth && line) {
          out.push(line);
          line = ch;
        } else line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function labelLines(el: El): string[] {
  const size = el.fontSize ?? 20;
  return wrapText(el.text || "", Math.max(10, el.w - LABEL_PAD * 2), size, el.fontFamily ?? "hand");
}

/** Recompute text-dependent geometry (text element size / container growth). */
export function fitText(el: El): El {
  const size = el.fontSize ?? 20;
  const fam = el.fontFamily ?? "hand";
  if (el.type === "text") {
    const m = measureLines((el.text ?? "").split("\n"), size, fam);
    return { ...el, w: Math.max(m.w, 2), h: Math.max(m.h, size * LINE_HEIGHT) };
  }
  if (hasLabel(el) && el.text) {
    const lines = labelLines(el);
    const th = lines.length * size * LINE_HEIGHT + LABEL_PAD * 2;
    const factor = el.type === "ellipse" ? 1.42 : el.type === "diamond" ? 1.8 : 1;
    if (th * factor > el.h) return { ...el, h: Math.ceil(th * factor) };
  }
  return el;
}

export interface StyleState {
  strokeColor: string;
  fillColor: string;
  fillStyle: El["fillStyle"];
  strokeWidth: number;
  strokeStyle: El["strokeStyle"];
  roughness: number;
  opacity: number;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: NonNullable<El["textAlign"]>;
  roundness: boolean;
  startArrow: NonNullable<El["startArrow"]>;
  endArrow: NonNullable<El["endArrow"]>;
  curved: boolean;
  stickyColor: string;
}

export const DEFAULT_STYLE: StyleState = {
  strokeColor: "#1e1e1e",
  fillColor: "#a5d8ff",
  fillStyle: "none",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  fontSize: 24,
  fontFamily: "hand",
  textAlign: "center",
  roundness: true,
  startArrow: "none",
  endArrow: "arrow",
  curved: false,
  stickyColor: "#ffec99",
};

export const STICKY_COLORS = ["#ffec99", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#d0bfff", "#ffd8a8"];

export function makeElement(type: ElType, props: Partial<El>, style: StyleState = DEFAULT_STYLE): El {
  const base: El = {
    id: randomId(),
    type,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    strokeColor: style.strokeColor,
    fillColor: style.fillColor,
    fillStyle: style.fillStyle,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    roughness: style.roughness,
    opacity: style.opacity,
    seed: randomSeed(),
    version: 1,
    nonce: randomSeed(),
    z: 0,
  };
  switch (type) {
    case "rectangle":
    case "diamond":
    case "ellipse":
      Object.assign(base, {
        roundness: type === "rectangle" ? style.roundness : undefined,
        fontSize: Math.min(style.fontSize, 20),
        fontFamily: style.fontFamily,
        textAlign: "center",
        text: "",
      });
      break;
    case "text":
      Object.assign(base, { fontSize: style.fontSize, fontFamily: style.fontFamily, textAlign: "left", text: "" });
      break;
    case "sticky":
      Object.assign(base, {
        fillColor: style.stickyColor,
        fillStyle: "solid",
        strokeColor: "#1e1e1e",
        fontSize: 22,
        fontFamily: style.fontFamily,
        textAlign: "center",
        text: "",
        roughness: 0,
      });
      break;
    case "line":
    case "arrow":
      Object.assign(base, {
        points: [[0, 0]],
        curved: style.curved,
        startArrow: type === "arrow" ? style.startArrow : "none",
        endArrow: type === "arrow" ? style.endArrow : "none",
      });
      break;
    case "freedraw":
      Object.assign(base, { points: [[0, 0]], fillStyle: "none", roughness: 0 });
      break;
    case "frame":
      Object.assign(base, {
        name: "프레임",
        strokeColor: "#868e96",
        fillColor: "#ffffff",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
      });
      break;
    case "image":
      Object.assign(base, { fillStyle: "none", roughness: 0 });
      break;
  }
  return { ...base, ...props };
}
