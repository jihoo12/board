import { useEffect, useState, type ReactNode } from "react";
import type { BoardMeta, ShareMode } from "../../shared/types";
import { api } from "../api";
import type { Editor, EditorState } from "../editor/editor";
import { Icons } from "./icons";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ShareDialog({ meta, onChange, onClose }: { meta: BoardMeta; onChange: (m: BoardMeta) => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/b/${meta.id}`;
  const setShare = async (share: ShareMode) => {
    await api.updateBoard(meta.id, { share });
    onChange({ ...meta, share });
  };
  const options: { v: ShareMode; title: string; desc: string }[] = [
    { v: "private", title: "🔒 비공개", desc: "나만 볼 수 있어요" },
    { v: "view", title: "👀 링크가 있으면 보기", desc: "누구나 볼 수 있고, 로그인 없이도 볼 수 있어요" },
    { v: "edit", title: "✏️ 링크가 있으면 편집", desc: "로그인한 사람은 함께 편집할 수 있어요" },
  ];
  return (
    <Modal title="공유" onClose={onClose}>
      {meta.isOwner ? (
        <div className="share-options">
          {options.map((o) => (
            <label key={o.v} className={`share-option ${meta.share === o.v ? "active" : ""}`}>
              <input type="radio" name="share" checked={meta.share === o.v} onChange={() => setShare(o.v)} />
              <div>
                <b>{o.title}</b>
                <span className="muted small">{o.desc}</span>
              </div>
            </label>
          ))}
        </div>
      ) : (
        <p className="muted">공유 설정은 보드 소유자({meta.owner.name})만 바꿀 수 있어요.</p>
      )}
      <div className="share-link">
        <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button
          className="btn btn-primary"
          disabled={meta.share === "private" && !meta.isOwner}
          onClick={async () => {
            await navigator.clipboard.writeText(link).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "복사됨!" : "링크 복사"}
        </button>
      </div>
      {meta.share === "private" && meta.isOwner && <p className="muted small">비공개 상태에서는 링크를 받아도 다른 사람은 열 수 없어요.</p>}
    </Modal>
  );
}

export function ExportDialog({ editor, state, title, onClose }: { editor: Editor; state: EditorState; title: string; onClose: () => void }) {
  const [onlySel, setOnlySel] = useState(state.selectedIds.length > 0);
  const [bg, setBg] = useState(true);
  const [scale, setScale] = useState(2);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    editor.exportPNG({ selectionOnly: onlySel, background: bg, scale: 1 }).then((b) => {
      if (!b || cancelled) return;
      url = URL.createObjectURL(b);
      setPreview(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [onlySel, bg]);

  const fileBase = title.replace(/[\\/:*?"<>|]+/g, "_") || "board";
  const download = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Modal title="내보내기" onClose={onClose}>
      <div className="export-preview" style={{ background: bg ? "#fbfbfa" : undefined }}>
        {preview ? <img src={preview} alt="미리보기" /> : <span className="muted">그릴 게 없어요</span>}
      </div>
      <div className="export-opts">
        {state.selectedIds.length > 0 && (
          <label><input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> 선택한 것만</label>
        )}
        <label><input type="checkbox" checked={bg} onChange={(e) => setBg(e.target.checked)} /> 배경 포함</label>
        <label>
          배율
          <select className="select" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={3}>3x</option>
          </select>
        </label>
      </div>
      <div className="modal-actions">
        <button
          className="btn"
          onClick={async () => {
            const b = await editor.exportPNG({ selectionOnly: onlySel, background: bg, scale });
            if (!b) return;
            try {
              await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
              editor.toast("이미지를 클립보드에 복사했어요");
            } catch {
              editor.toast("이 브라우저에서는 이미지 복사가 안 돼요");
            }
          }}
        >
          <Icons.copy /> 클립보드에 복사
        </button>
        <button className="btn" onClick={() => download(new Blob([editor.exportJSON()], { type: "application/json" }), `${fileBase}.inkboard.json`)}>
          <Icons.download /> JSON
        </button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            const b = await editor.exportPNG({ selectionOnly: onlySel, background: bg, scale });
            if (b) download(b, `${fileBase}.png`);
          }}
        >
          <Icons.download /> PNG 저장
        </button>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["V / 1", "선택"], ["H / Space+드래그", "화면 이동"], ["R / D / O", "사각형 / 마름모 / 원"], ["A / L", "화살표 / 선"],
  ["P", "펜"], ["T / 더블클릭", "텍스트"], ["S", "스티키 노트"], ["F", "프레임"], ["E", "지우개"], ["K", "레이저 포인터"],
  ["I", "이미지 (붙여넣기·드래그도 가능)"], ["Q", "도구 고정"], ["Ctrl+Z / Ctrl+Shift+Z", "실행 취소 / 다시 실행"],
  ["Ctrl+C / V / X", "복사 / 붙여넣기 / 잘라내기"], ["Ctrl+D", "복제"], ["Alt+드래그", "복제하며 이동"],
  ["Ctrl+G / Ctrl+Shift+G", "그룹 / 그룹 해제"], ["Ctrl+] / [", "앞으로 / 뒤로"], ["Shift", "비율 고정 · 수평/수직 고정"],
  ["Ctrl (드래그 중)", "스냅 끄기"], ["Ctrl+'", "격자 켜기/끄기"], ["Shift+1 / Shift+2", "전체 보기 / 선택 영역 보기"],
  ["Ctrl+휠 / 핀치", "확대·축소"], ["Enter", "선택한 도형 글자 편집"], ["Delete", "삭제"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="단축키 & 팁" onClose={onClose}>
      <div className="shortcuts">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="shortcut">
            <kbd>{k}</kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        💡 화살표를 도형 위에서 시작하거나 끝내면 도형에 붙어서 같이 움직여요. 선을 선택하면 가운데 점을 끌어 꺾을 수 있어요.
      </p>
    </Modal>
  );
}

export function ContextMenu({ editor, state }: { editor: Editor; state: EditorState }) {
  const m = state.menu;
  if (!m) return null;
  const has = state.selectedIds.length > 0;
  const close = () => editor.setState({ menu: null });
  const item = (label: string, action: () => void, opts: { shortcut?: string; danger?: boolean; show?: boolean } = {}) =>
    opts.show === false ? null : (
      <button
        key={label}
        className={opts.danger ? "danger" : ""}
        onClick={() => {
          close();
          action();
        }}
      >
        <span>{label}</span>
        {opts.shortcut && <kbd>{opts.shortcut}</kbd>}
      </button>
    );
  const sel = state.selectedIds.map((id) => editor.els.get(id)).filter(Boolean);
  const canEdit = state.canEdit;
  return (
    <div
      className="context-menu"
      style={{ left: Math.min(m.x, window.innerWidth - 230), top: Math.min(m.y, window.innerHeight - 380) }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {has ? (
        <>
          {item("복사", () => editor.copySelection(), { shortcut: "Ctrl+C" })}
          {item("붙여넣기", () => editor.pasteFromClipboard(), { shortcut: "Ctrl+V", show: canEdit })}
          {item("복제", () => editor.duplicate(), { shortcut: "Ctrl+D", show: canEdit })}
          <hr />
          {item("맨 앞으로", () => editor.reorder("front"), { shortcut: "Ctrl+Shift+]", show: canEdit })}
          {item("맨 뒤로", () => editor.reorder("back"), { shortcut: "Ctrl+Shift+[", show: canEdit })}
          {item("그룹", () => editor.group(), { shortcut: "Ctrl+G", show: canEdit && sel.length > 1 })}
          {item("그룹 해제", () => editor.ungroup(), { shortcut: "Ctrl+Shift+G", show: canEdit && sel.some((e) => e?.groupId) })}
          {item(sel.every((e) => e?.locked) ? "잠금 해제" : "잠금", () => editor.toggleLock(), { show: canEdit })}
          {item("선택 영역 보기", () => editor.zoomToFit(editor.selected()), { shortcut: "Shift+2" })}
          <hr />
          {item("삭제", () => editor.deleteSelected(), { shortcut: "Del", danger: true, show: canEdit })}
        </>
      ) : (
        <>
          {item("붙여넣기", () => editor.pasteFromClipboard(), { shortcut: "Ctrl+V", show: canEdit })}
          {item("모두 선택", () => editor.select(editor.live().map((e) => e.id)), { shortcut: "Ctrl+A" })}
          {item("전체 보기", () => editor.zoomToFit(), { shortcut: "Shift+1" })}
          {item(state.grid ? "격자 끄기" : "격자 켜기", () => editor.setState({ grid: !state.grid }), { shortcut: "Ctrl+'" })}
          {item("잠금 모두 해제", () => editor.unlockAll(), { show: canEdit && editor.live().some((e) => e.locked) })}
        </>
      )}
    </div>
  );
}
