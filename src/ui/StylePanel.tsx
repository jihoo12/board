import type { ReactNode } from "react";
import type { El, ElType } from "../../shared/types";
import type { Editor, EditorState } from "../editor/editor";
import { STICKY_COLORS, type StyleState } from "../editor/elements";
import { Icons } from "./icons";

const STROKES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5"];
const FILLS = ["#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#d0bfff"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="panel-row">
      <div className="panel-label">{label}</div>
      <div className="panel-controls">{children}</div>
    </div>
  );
}

function Opt<T extends string | number | boolean>({
  value, current, onPick, title, children,
}: { value: T; current: T; onPick: (v: T) => void; title: string; children: ReactNode }) {
  return (
    <button className={`opt ${value === current ? "active" : ""}`} title={title} aria-label={title} onClick={() => onPick(value)}>
      {children}
    </button>
  );
}

function Swatches({ colors, current, onPick, allowNone }: { colors: string[]; current: string | null; onPick: (c: string | null) => void; allowNone?: boolean }) {
  return (
    <>
      {allowNone && (
        <button className={`swatch swatch-none ${current === null ? "active" : ""}`} title="투명" onClick={() => onPick(null)} />
      )}
      {colors.map((c) => (
        <button key={c} className={`swatch ${current?.toLowerCase() === c ? "active" : ""}`} style={{ background: c }} title={c} onClick={() => onPick(c)} />
      ))}
      <label className="swatch swatch-custom" title="직접 고르기">
        <input type="color" value={current && current.startsWith("#") && current.length === 7 ? current : "#000000"} onChange={(e) => onPick(e.target.value)} />
      </label>
    </>
  );
}

const TOOL_TYPE: Partial<Record<EditorState["tool"], ElType>> = {
  rectangle: "rectangle", diamond: "diamond", ellipse: "ellipse", arrow: "arrow", line: "line",
  freedraw: "freedraw", text: "text", sticky: "sticky", frame: "frame", math: "text",
};

export function StylePanel({ editor, state }: { editor: Editor; state: EditorState }) {
  const sel = state.selectedIds.map((id) => editor.els.get(id)).filter((e): e is El => !!e && !e.isDeleted);
  const toolType = TOOL_TYPE[state.tool];
  if (!state.canEdit || (!sel.length && !toolType)) return null;
  const types = new Set<ElType>(sel.length ? sel.map((e) => e.type) : [toolType!]);
  const first = sel[0];
  const st = state.style;
  const v = <K extends keyof StyleState>(k: K): StyleState[K] => {
    if (first && k in first) return (first as unknown as StyleState)[k] ?? st[k];
    return st[k];
  };
  const set = (patch: Partial<StyleState>) => editor.setStyle(patch);
  const has = (...t: ElType[]) => t.some((x) => types.has(x));
  const shapes = has("rectangle", "ellipse", "diamond");
  const stroked = has("rectangle", "ellipse", "diamond", "arrow", "line", "freedraw", "text");
  const onlyMath = sel.length ? sel.every((e) => e.math) : state.tool === "math";
  const hasText = has("text", "sticky") || (shapes && sel.some((e) => e.text)) || (shapes && !sel.length);
  const fillStyle = shapes ? (first && first.type !== "sticky" ? first.fillStyle : st.fillStyle) : "none";
  const fillColor = first && shapes ? first.fillColor : st.fillColor;

  return (
    <div className="panel style-panel" onPointerDown={(e) => e.stopPropagation()}>
      {stroked && (
        <Row label={types.has("text") && types.size === 1 ? "글자 색" : "선 색"}>
          <Swatches colors={STROKES} current={v("strokeColor")} onPick={(c) => c && set({ strokeColor: c })} />
        </Row>
      )}
      {has("sticky") && (
        <Row label="노트 색">
          <Swatches colors={STICKY_COLORS} current={first?.type === "sticky" ? first.fillColor : st.stickyColor} onPick={(c) => c && set({ stickyColor: c })} />
        </Row>
      )}
      {shapes && (
        <Row label="채우기">
          <Swatches
            colors={FILLS}
            allowNone
            current={fillStyle === "none" ? null : fillColor}
            onPick={(c) =>
              c === null ? set({ fillStyle: "none" }) : set({ fillColor: c, fillStyle: fillStyle === "none" ? "hachure" : fillStyle })
            }
          />
        </Row>
      )}
      {shapes && fillStyle !== "none" && (
        <Row label="채우기 스타일">
          <Opt title="빗금" value="hachure" current={fillStyle} onPick={(x) => set({ fillStyle: x })}>
            <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" rx="2" fill="none" stroke="currentColor" /><path d="M2 10l8-8M2 16L16 2M8 16l8-8" stroke="currentColor" /></svg>
          </Opt>
          <Opt title="격자" value="cross-hatch" current={fillStyle} onPick={(x) => set({ fillStyle: x })}>
            <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" rx="2" fill="none" stroke="currentColor" /><path d="M2 10l8-8M2 16L16 2M8 16l8-8M8 2l8 8M2 2l14 14M2 8l8 8" stroke="currentColor" /></svg>
          </Opt>
          <Opt title="단색" value="solid" current={fillStyle} onPick={(x) => set({ fillStyle: x })}>
            <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" rx="2" fill="currentColor" /></svg>
          </Opt>
        </Row>
      )}
      {has("rectangle", "ellipse", "diamond", "arrow", "line", "freedraw") && (
        <Row label="선 굵기">
          {[1, 2, 4].map((w) => (
            <Opt key={w} title={`${w}px`} value={w} current={v("strokeWidth")} onPick={(x) => set({ strokeWidth: x })}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 9h12" stroke="currentColor" strokeWidth={w * 1.2} strokeLinecap="round" /></svg>
            </Opt>
          ))}
        </Row>
      )}
      {has("rectangle", "ellipse", "diamond", "arrow", "line") && (
        <>
          <Row label="선 모양">
            {(["solid", "dashed", "dotted"] as const).map((s) => (
              <Opt key={s} title={{ solid: "실선", dashed: "파선", dotted: "점선" }[s]} value={s} current={v("strokeStyle")} onPick={(x) => set({ strokeStyle: x })}>
                <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 9h14" stroke="currentColor" strokeWidth="2" strokeDasharray={s === "dashed" ? "4 3" : s === "dotted" ? "1 3" : undefined} strokeLinecap="round" /></svg>
              </Opt>
            ))}
          </Row>
          <Row label="손그림 정도">
            {[0, 1, 2].map((r) => (
              <Opt key={r} title={["깔끔", "스케치", "엉성"][r]} value={r} current={v("roughness")} onPick={(x) => set({ roughness: x })}>
                <svg width="18" height="18" viewBox="0 0 18 18"><path d={["M2 12 C6 6, 12 6, 16 12", "M2 12 C5 5, 9 9, 11 6 S15 9, 16 12", "M2 13 L4 6 L7 11 L9 4 L12 12 L14 6 L16 12"][r]} fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
              </Opt>
            ))}
          </Row>
        </>
      )}
      {has("rectangle") && (
        <Row label="모서리">
          <Opt title="각진" value={false} current={first?.type === "rectangle" ? !!first.roundness : st.roundness} onPick={(x) => set({ roundness: x })}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 15V3h12" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          </Opt>
          <Opt title="둥근" value={true} current={first?.type === "rectangle" ? !!first.roundness : st.roundness} onPick={(x) => set({ roundness: x })}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3 15V9a6 6 0 016-6h6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          </Opt>
        </Row>
      )}
      {has("arrow", "line") && (
        <Row label="선 종류">
          <Opt title="직선" value={false} current={v("curved")} onPick={(x) => set({ curved: x })}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 14L8 5l8 9" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          </Opt>
          <Opt title="곡선" value={true} current={v("curved")} onPick={(x) => set({ curved: x })}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 14C5 2 11 2 16 14" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          </Opt>
        </Row>
      )}
      {has("arrow") && (
        <Row label="화살촉">
          <select className="select" value={v("startArrow")} onChange={(e) => set({ startArrow: e.target.value as StyleState["startArrow"] })} title="시작">
            <option value="none">시작: 없음</option>
            <option value="arrow">시작: 화살</option>
            <option value="triangle">시작: 삼각</option>
            <option value="dot">시작: 점</option>
            <option value="bar">시작: 막대</option>
          </select>
          <select className="select" value={v("endArrow")} onChange={(e) => set({ endArrow: e.target.value as StyleState["endArrow"] })} title="끝">
            <option value="none">끝: 없음</option>
            <option value="arrow">끝: 화살</option>
            <option value="triangle">끝: 삼각</option>
            <option value="dot">끝: 점</option>
            <option value="bar">끝: 막대</option>
          </select>
        </Row>
      )}
      {hasText && (
        <>
          {!onlyMath && <Row label="글꼴">
            <Opt title="손글씨" value="hand" current={v("fontFamily")} onPick={(x) => set({ fontFamily: x })}><span style={{ fontFamily: "Patrick Hand, Gaegu" }}>가a</span></Opt>
            <Opt title="기본" value="sans" current={v("fontFamily")} onPick={(x) => set({ fontFamily: x })}><span style={{ fontFamily: "Inter, Noto Sans KR" }}>가a</span></Opt>
            <Opt title="코드" value="mono" current={v("fontFamily")} onPick={(x) => set({ fontFamily: x })}><span style={{ fontFamily: "JetBrains Mono" }}>{"</>"}</span></Opt>
          </Row>}
          <Row label="글자 크기">
            {[[16, "S"], [24, "M"], [36, "L"], [56, "XL"]].map(([s, l]) => (
              <Opt key={s} title={`${s}px`} value={s as number} current={Math.round(v("fontSize"))} onPick={(x) => set({ fontSize: x })}>{l}</Opt>
            ))}
          </Row>
          {!onlyMath && <Row label="정렬">
            {(["left", "center", "right"] as const).map((a) => (
              <Opt key={a} title={{ left: "왼쪽", center: "가운데", right: "오른쪽" }[a]} value={a} current={v("textAlign")} onPick={(x) => set({ textAlign: x })}>
                <svg width="18" height="18" viewBox="0 0 18 18"><path d={{ left: "M2 4h14M2 9h9M2 14h12", center: "M2 4h14M4.5 9h9M3 14h12", right: "M2 4h14M7 9h9M4 14h12" }[a]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </Opt>
            ))}
          </Row>}
        </>
      )}
      <Row label={`투명도 ${v("opacity")}%`}>
        <input className="range" type="range" min={10} max={100} step={10} value={v("opacity")} onChange={(e) => set({ opacity: Number(e.target.value) })} />
      </Row>

      {sel.length > 0 && (
        <>
          <Row label="레이어">
            <button className="opt" title="맨 뒤로 (Ctrl+Shift+[)" onClick={() => editor.reorder("back")}><Icons.back /></button>
            <button className="opt" title="뒤로 (Ctrl+[)" onClick={() => editor.reorder("backward")}>↓</button>
            <button className="opt" title="앞으로 (Ctrl+])" onClick={() => editor.reorder("forward")}>↑</button>
            <button className="opt" title="맨 앞으로 (Ctrl+Shift+])" onClick={() => editor.reorder("front")}><Icons.front /></button>
          </Row>
          {sel.length > 1 && (
            <Row label="정렬 / 분배">
              <button className="opt" title="왼쪽 정렬" onClick={() => editor.align("left")}><Icons.alignLeft /></button>
              <button className="opt" title="가로 가운데" onClick={() => editor.align("hcenter")}><Icons.alignHCenter /></button>
              <button className="opt" title="오른쪽 정렬" onClick={() => editor.align("right")}><Icons.alignRight /></button>
              <button className="opt" title="위쪽 정렬" onClick={() => editor.align("top")}><Icons.alignTop /></button>
              <button className="opt" title="세로 가운데" onClick={() => editor.align("vcenter")}><Icons.alignVCenter /></button>
              <button className="opt" title="아래쪽 정렬" onClick={() => editor.align("bottom")}><Icons.alignBottom /></button>
              {sel.length > 2 && (
                <>
                  <button className="opt" title="가로 간격 맞추기" onClick={() => editor.distribute("h")}><Icons.distH /></button>
                  <button className="opt" title="세로 간격 맞추기" onClick={() => editor.distribute("v")}><Icons.distV /></button>
                </>
              )}
            </Row>
          )}
          <Row label="동작">
            <button className="opt" title="복제 (Ctrl+D)" onClick={() => editor.duplicate()}><Icons.copy /></button>
            {sel.length > 1 && <button className="opt" title="그룹 (Ctrl+G)" onClick={() => editor.group()}><Icons.group /></button>}
            {sel.some((e) => e.groupId) && <button className="opt" title="그룹 해제 (Ctrl+Shift+G)" onClick={() => editor.ungroup()}>⤧</button>}
            <button className="opt" title="잠금" onClick={() => editor.toggleLock()}><Icons.lock /></button>
            <button className="opt danger" title="삭제 (Delete)" onClick={() => editor.deleteSelected()}><Icons.trash /></button>
          </Row>
        </>
      )}
    </div>
  );
}
