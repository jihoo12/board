import type { El } from "../shared/types";
import { DEFAULT_STYLE, fitText, makeElement, STICKY_COLORS } from "./editor/elements";
import { borderPoint, center, type Pt } from "./editor/geometry";

export interface Template {
  id: string;
  name: string;
  emoji: string;
  description: string;
  build: () => El[];
}

const style = { ...DEFAULT_STYLE };

function sticky(x: number, y: number, text: string, color = STICKY_COLORS[0], w = 180, h = 140): El {
  return fitText(makeElement("sticky", { x, y, w, h, text, fillColor: color }, style));
}
function frame(x: number, y: number, w: number, h: number, name: string): El {
  return makeElement("frame", { x, y, w, h, name }, style);
}
function text(x: number, y: number, t: string, fontSize = 28, extra: Partial<El> = {}): El {
  return fitText(makeElement("text", { x, y, text: t, fontSize, ...extra }, style));
}
function shape(type: "rectangle" | "ellipse" | "diamond", x: number, y: number, w: number, h: number, label: string, extra: Partial<El> = {}): El {
  return fitText(makeElement(type, { x, y, w, h, text: label, ...extra }, style));
}
function connect(a: El, b: El, extra: Partial<El> = {}): El {
  const s = borderPoint(a, center(b));
  const e = borderPoint(b, center(a));
  const pts: Pt[] = [s, e];
  return makeElement("arrow", {
    x: s[0], y: s[1], points: pts.map(([x, y]) => [x - s[0], y - s[1]]) as [number, number][],
    w: Math.abs(e[0] - s[0]), h: Math.abs(e[1] - s[1]), startBind: a.id, endBind: b.id, ...extra,
  }, style);
}

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "빈 보드",
    emoji: "✨",
    description: "아무것도 없는 무한 캔버스",
    build: () => [],
  },
  {
    id: "kanban",
    name: "칸반 보드",
    emoji: "🗂️",
    description: "할 일 · 진행 중 · 완료",
    build: () => {
      const cols = [
        { name: "📋 할 일", items: ["디자인 시안 만들기", "API 스펙 정리", "회의 일정 잡기"], color: STICKY_COLORS[0] },
        { name: "🚧 진행 중", items: ["로그인 기능", "보드 공유 기능"], color: STICKY_COLORS[3] },
        { name: "✅ 완료", items: ["프로젝트 셋업"], color: STICKY_COLORS[2] },
      ];
      const out: El[] = [];
      cols.forEach((c, i) => {
        const x = i * 300;
        out.push(frame(x, 0, 260, 620, c.name));
        c.items.forEach((t, j) => out.push(sticky(x + 40, 40 + j * 180, t, c.color)));
      });
      return out;
    },
  },
  {
    id: "brainstorm",
    name: "브레인스토밍",
    emoji: "🧠",
    description: "가운데 주제에서 아이디어 펼치기",
    build: () => {
      const hub = shape("ellipse", -110, -60, 220, 120, "중심 주제", {
        fillStyle: "solid", fillColor: "#d0bfff", fontSize: 26,
      });
      const ideas = ["아이디어 1", "아이디어 2", "아이디어 3", "아이디어 4", "아이디어 5"];
      const out: El[] = [hub];
      ideas.forEach((t, i) => {
        const a = (i / ideas.length) * Math.PI * 2 - Math.PI / 2;
        const s = sticky(Math.cos(a) * 340 - 80, Math.sin(a) * 260 - 60, t, STICKY_COLORS[i % STICKY_COLORS.length], 160, 120);
        out.push(s, connect(hub, s, { endArrow: "none", strokeStyle: "dashed" }));
      });
      return out;
    },
  },
  {
    id: "flow",
    name: "플로우차트",
    emoji: "🔀",
    description: "시작 → 처리 → 판단 → 끝",
    build: () => {
      const start = shape("ellipse", 0, 0, 160, 70, "시작", { fillStyle: "hachure", fillColor: "#b2f2bb" });
      const step = shape("rectangle", 0, 140, 160, 80, "입력 받기", { fillStyle: "hachure", fillColor: "#a5d8ff" });
      const cond = shape("diamond", -10, 290, 180, 130, "올바른가?", { fillStyle: "hachure", fillColor: "#ffec99" });
      const ok = shape("rectangle", 0, 500, 160, 80, "저장하기", { fillStyle: "hachure", fillColor: "#a5d8ff" });
      const err = shape("rectangle", 280, 315, 160, 80, "오류 표시", { fillStyle: "hachure", fillColor: "#ffc9c9" });
      const end = shape("ellipse", 0, 650, 160, 70, "끝", { fillStyle: "hachure", fillColor: "#b2f2bb" });
      const yes = text(95, 440, "예", 20);
      const no = text(195, 325, "아니오", 20);
      return [
        start, step, cond, ok, err, end, yes, no,
        connect(start, step), connect(step, cond), connect(cond, ok), connect(cond, err), connect(ok, end),
      ];
    },
  },
  {
    id: "retro",
    name: "회고",
    emoji: "🪞",
    description: "좋았던 점 · 아쉬운 점 · 해볼 것",
    build: () => {
      const cols = [
        { name: "😊 좋았던 점", color: STICKY_COLORS[2] },
        { name: "😥 아쉬운 점", color: STICKY_COLORS[1] },
        { name: "🚀 해볼 것", color: STICKY_COLORS[3] },
      ];
      const out: El[] = [text(0, -90, "스프린트 회고", 40, { fontFamily: "hand" })];
      cols.forEach((c, i) => {
        const x = i * 420;
        out.push(frame(x, 0, 380, 520, c.name));
        out.push(sticky(x + 30, 30, "여기에 적어 주세요", c.color, 150, 120));
      });
      return out;
    },
  },
];

/** Build a template's elements with a sane paint order (frames at the back). */
export function buildTemplate(t: Template): El[] {
  return t.build().map((e, i) => ({ ...e, z: e.type === "frame" ? -1000 + i : i + 1 }));
}
