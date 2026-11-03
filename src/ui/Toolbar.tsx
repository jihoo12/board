import type { Editor, EditorState, Tool } from "../editor/editor";
import { Icons, type IconName } from "./icons";

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string; viewer?: boolean }[] = [
  { tool: "hand", icon: "hand", label: "손 (H) — 화면 이동", key: "H", viewer: true },
  { tool: "select", icon: "select", label: "선택 (V)", key: "1", viewer: true },
  { tool: "rectangle", icon: "rectangle", label: "사각형 (R)", key: "2" },
  { tool: "diamond", icon: "diamond", label: "마름모 (D)", key: "3" },
  { tool: "ellipse", icon: "ellipse", label: "원 (O)", key: "4" },
  { tool: "arrow", icon: "arrow", label: "화살표 (A) — 도형에 붙어요", key: "5" },
  { tool: "line", icon: "line", label: "선 (L)", key: "6" },
  { tool: "freedraw", icon: "freedraw", label: "펜 (P)", key: "7" },
  { tool: "text", icon: "text", label: "텍스트 (T)", key: "8" },
  { tool: "sticky", icon: "sticky", label: "스티키 노트 (S)", key: "9" },
  { tool: "image", icon: "image", label: "이미지 (I)", key: "" },
  { tool: "frame", icon: "frame", label: "프레임 (F)", key: "" },
  { tool: "eraser", icon: "eraser", label: "지우개 (E)", key: "" },
  { tool: "laser", icon: "laser", label: "레이저 포인터 (K) — 다른 사람에게도 보여요", key: "", viewer: true },
];

export function Toolbar({ editor, state }: { editor: Editor; state: EditorState }) {
  const tools = state.canEdit ? TOOLS : TOOLS.filter((t) => t.viewer);
  return (
    <div className="toolbar" onPointerDown={(e) => e.stopPropagation()}>
      {state.canEdit && (
        <button
          className={`tool lock ${state.toolLock ? "active" : ""}`}
          title="도구 고정 (Q) — 그린 뒤에도 도구 유지"
          aria-label="도구 고정"
          onClick={() => editor.setState({ toolLock: !state.toolLock })}
        >
          {state.toolLock ? <Icons.lock /> : <Icons.unlock />}
        </button>
      )}
      {state.canEdit && <span className="toolbar-sep" />}
      {tools.map((t) => {
        const C = Icons[t.icon];
        return (
          <button
            key={t.tool}
            className={`tool ${state.tool === t.tool ? "active" : ""}`}
            title={t.label}
            aria-label={t.label}
            onClick={() => editor.setTool(t.tool)}
          >
            <C />
            {t.key && <span className="tool-key">{t.key}</span>}
          </button>
        );
      })}
      {!state.canEdit && <span className="readonly-badge">보기 전용</span>}
    </div>
  );
}
