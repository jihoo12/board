// LaTeX rendering for "math" text elements.
//
// MathJax (SVG output) turns TeX into a self-contained SVG made of paths, which we
// load as an <img> and draw onto the canvas. The ~2MB MathJax bundle is only
// fetched the first time a board actually contains (or creates) a formula.
import mathjaxUrl from "mathjax/es5/tex-svg-full.js?url";

interface MathJaxApi {
  tex2svg(src: string, opts?: { display?: boolean }): HTMLElement;
  texReset(): void;
  startup: { defaultReady(): void; promise: Promise<void> };
}

export interface MathLayout {
  /** self-contained SVG markup (uses currentColor) */
  svg: string;
  /** size in em – multiply by the font size to get scene units */
  w: number;
  h: number;
  error: boolean;
}

let mj: MathJaxApi | null = null;
let loading: Promise<void> | null = null;
let failed = false;
let repaint: (() => void) | null = null;

const MAX_CACHE = 400;
const layouts = new Map<string, MathLayout>();
const images = new Map<string, HTMLImageElement>();

/** Called whenever something math-related finished loading and the canvas should redraw. */
export function setMathRepaint(fn: (() => void) | null) {
  repaint = fn;
}

export function isMathReady() {
  return !!mj;
}

export function loadMath(): Promise<void> {
  if (mj) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const w = window as unknown as { MathJax: unknown };
      w.MathJax = {
        startup: {
          typeset: false,
          ready() {
            const api = (window as unknown as { MathJax: MathJaxApi }).MathJax;
            api.startup.defaultReady();
            api.startup.promise.then(() => {
              mj = api;
              failed = false;
              resolve();
              repaint?.();
            }, reject);
          },
        },
        // inline every glyph path into each SVG so it renders on its own as an <img>
        svg: { fontCache: "none" },
        options: { enableMenu: false },
      };
      const s = document.createElement("script");
      s.src = mathjaxUrl;
      s.async = true;
      s.onerror = () => {
        loading = null;
        failed = true;
        s.remove();
        reject(new Error("수식 엔진을 불러오지 못했어요"));
        repaint?.();
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

function remember<V>(map: Map<string, V>, key: string, value: V) {
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value!);
  map.set(key, value);
}

/** Synchronous TeX layout. Returns null until MathJax has loaded (and kicks off the load). */
export function mathLayout(src: string): MathLayout | null {
  if (!mj) {
    if (!failed) loadMath().catch(() => {});
    return null;
  }
  const hit = layouts.get(src);
  if (hit) return hit;
  let out: MathLayout;
  try {
    mj.texReset();
    const node = mj.tex2svg(src, { display: true });
    const svg = node.querySelector("svg");
    if (!svg) throw new Error("no svg");
    const vb = svg.viewBox.baseVal;
    // MathJax SVG uses 1000 units per em
    const w = Math.max(vb.width / 1000, 0.1);
    const h = Math.max(vb.height / 1000, 0.1);
    svg.removeAttribute("style");
    svg.removeAttribute("role");
    svg.removeAttribute("focusable");
    svg.setAttribute("width", String(Math.ceil(w * 64)));
    svg.setAttribute("height", String(Math.ceil(h * 64)));
    out = { svg: svg.outerHTML, w, h, error: !!svg.querySelector('[data-mml-node="merror"]') };
  } catch {
    out = { svg: "", w: 1, h: 1, error: true };
  }
  remember(layouts, src, out);
  return out;
}

function safeColor(c: string) {
  return /^[#a-zA-Z0-9(),.\s%]+$/.test(c) ? c : "#1e1e1e";
}

/** Rendered image for a formula in the given color, or null while not ready. */
export function mathImage(src: string, color: string): HTMLImageElement | null {
  const layout = mathLayout(src);
  if (!layout || !layout.svg) return null;
  const key = `${color}\u0000${src}`;
  let img = images.get(key);
  if (!img) {
    img = new Image();
    img.onload = () => repaint?.();
    const svg = layout.svg.replace("<svg", `<svg color="${safeColor(color)}"`);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    remember(images, key, img);
  }
  return img;
}

/** Wait until the image for this formula is decoded (used for PNG export / thumbnails). */
export async function mathImageReady(src: string, color: string): Promise<void> {
  try {
    await loadMath();
  } catch {
    return;
  }
  const img = mathImage(src, color);
  if (img && !img.complete) await img.decode().catch(() => {});
}

export function mathFailed() {
  return failed;
}
