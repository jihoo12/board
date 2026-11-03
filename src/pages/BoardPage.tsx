import { useEffect, useRef, useState } from "react";
import type { BoardMeta } from "../../shared/types";
import { api, ApiError } from "../api";
import type { Session } from "../App";
import { Editor } from "../editor/editor";
import { navigate } from "../router";
import { Avatar } from "../ui/Avatar";
import { ContextMenu, ExportDialog, HelpDialog, ShareDialog } from "../ui/Dialogs";
import { Icons } from "../ui/icons";
import { StylePanel } from "../ui/StylePanel";
import { Toolbar } from "../ui/Toolbar";
import { useEditorState } from "../ui/useEditor";
import { LoginButtons } from "./Landing";

export function BoardPage({ boardId, session }: { boardId: string; session: Session }) {
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    api.board(boardId).then(setMeta).catch((e: ApiError) => setError({ status: e.status, message: e.message }));
  }, [boardId]);

  if (error) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>{error.status === 401 ? "로그인이 필요해요" : error.status === 404 ? "보드를 찾을 수 없어요" : "열 수 없어요"}</h2>
          <p className="muted">{error.status === 401 ? "이 보드를 보려면 로그인해 주세요." : error.message}</p>
          {error.status === 401 ? <LoginButtons session={session} /> : <button className="btn" onClick={() => navigate("/")}>처음으로</button>}
        </div>
      </div>
    );
  }
  if (!meta) return <div className="center-page"><div className="spinner" /></div>;
  return <BoardView meta={meta} setMeta={setMeta} session={session} />;
}

function BoardView({ meta, setMeta, session }: { meta: BoardMeta; setMeta: (m: BoardMeta) => void; session: Session }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editor] = useState(() => new Editor());
  const state = useEditorState(editor);
  const [dialog, setDialog] = useState<"share" | "export" | "help" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [title, setTitle] = useState(meta.title);

  useEffect(() => {
    document.title = `${meta.title} · Inkboard`;
  }, [meta.title]);

  useEffect(() => {
    const host = hostRef.current!;
    editor.mount(host);
    editor.connect(meta.id, meta.canEdit);

    // thumbnails for the dashboard, generated a few seconds after the last local edit
    let thumbTimer = 0;
    let dirty = false;
    const saveThumb = async () => {
      if (!dirty) return;
      dirty = false;
      const t = await editor.thumbnail();
      if (t) api.saveThumbnail(meta.id, t).catch(() => {});
    };
    editor.onLocalChange = () => {
      dirty = true;
      clearTimeout(thumbTimer);
      thumbTimer = window.setTimeout(saveThumb, 4000);
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      saveThumb();
      if (!editor.flush()) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      clearTimeout(thumbTimer);
      saveThumb();
      window.removeEventListener("beforeunload", beforeUnload);
      editor.destroy();
    };
  }, [editor, meta.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const saveTitle = async () => {
    const t = title.trim() || "제목 없는 보드";
    setTitle(t);
    if (t !== meta.title) {
      await api.updateBoard(meta.id, { title: t }).catch(() => {});
      setMeta({ ...meta, title: t });
    }
  };

  const statusText = { connecting: "연결 중…", online: "저장됨", offline: "오프라인 — 다시 연결 중", deleted: "삭제된 보드" }[state.status];

  return (
    <div className={`board-page ${state.theme === "dark" ? "dark" : ""}`}>
      <div ref={hostRef} className="canvas-host" />

      {/* top-left: menu + title */}
      <div className="top-left" onPointerDown={(e) => e.stopPropagation()}>
        <div className="menu-wrap">
          <button className="icon-btn panel-btn" aria-label="메뉴" onClick={() => setMenuOpen(!menuOpen)}><Icons.menu /></button>
          {menuOpen && (
            <div className="dropdown" onPointerDown={(e) => e.stopPropagation()}>
              {session.user && <button onClick={() => navigate("/")}><Icons.home /> 내 보드</button>}
              <button onClick={() => { setMenuOpen(false); setDialog("export"); }}><Icons.download /> 내보내기</button>
              {state.canEdit && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".json,application/json";
                    input.onchange = () => input.files?.[0]?.text().then((t) => editor.importJSON(t));
                    input.click();
                  }}
                >
                  <Icons.upload /> JSON 가져오기
                </button>
              )}
              <button onClick={() => { editor.setState({ theme: state.theme === "dark" ? "light" : "dark" }); }}>
                {state.theme === "dark" ? <Icons.sun /> : <Icons.moon />} {state.theme === "dark" ? "밝은 테마" : "어두운 테마"}
              </button>
              <button onClick={() => editor.setState({ grid: !state.grid })}><Icons.grid /> 격자 {state.grid ? "끄기" : "켜기"}</button>
              <button onClick={() => { setMenuOpen(false); setDialog("help"); }}><Icons.help /> 단축키</button>
              {state.canEdit && (
                <button
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    if (confirm("보드의 모든 내용을 지울까요? (실행 취소 가능)")) editor.clearBoard();
                  }}
                >
                  <Icons.trash /> 캔버스 비우기
                </button>
              )}
            </div>
          )}
        </div>
        <div className="title-box panel">
          {state.canEdit ? (
            <input
              className="title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              maxLength={120}
              aria-label="보드 이름"
            />
          ) : (
            <span className="title-input">{meta.title}</span>
          )}
          <span className={`status-dot ${state.status}`} title={statusText} />
        </div>
      </div>

      <Toolbar editor={editor} state={state} />

      {/* top-right: presence + share */}
      <div className="top-right" onPointerDown={(e) => e.stopPropagation()}>
        <div className="peers">
          {state.peers.slice(0, 5).map((p) => (
            <button key={p.cid} className="peer" title={`${p.name}${p.hasCursor ? " — 클릭해서 따라가기" : ""}`} onClick={() => editor.scrollToPeer(p.cid)}>
              <Avatar name={p.name} src={p.avatar} size={30} color={p.color} />
            </button>
          ))}
          {state.peers.length > 5 && <span className="peer-more">+{state.peers.length - 5}</span>}
          {state.self && (
            <span className="peer self" title={`나 (${state.self.name})`}>
              <Avatar name={state.self.name} src={state.self.avatar} size={30} color={state.self.color} />
            </span>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setDialog("share")} aria-label="공유"><Icons.share /> <span>공유</span></button>
        {!session.user && <a className="btn" href={`/auth/${session.providers.github ? "github" : session.providers.google ? "google" : "dev"}?return=${encodeURIComponent(location.pathname)}`}>로그인</a>}
      </div>

      <StylePanel editor={editor} state={state} />

      {/* bottom-left: zoom + history */}
      <div className="bottom-left" onPointerDown={(e) => e.stopPropagation()}>
        <div className="panel zoom-box">
          <button className="icon-btn" aria-label="축소" onClick={() => editor.zoomBy(1 / 1.2)}><Icons.minus /></button>
          <button className="zoom-label" title="100%로 (Ctrl+0)" onClick={() => editor.resetZoom()}>{Math.round(state.zoom * 100)}%</button>
          <button className="icon-btn" aria-label="확대" onClick={() => editor.zoomBy(1.2)}><Icons.plus /></button>
          <button className="icon-btn" aria-label="전체 보기" title="전체 보기 (Shift+1)" onClick={() => editor.zoomToFit()}><Icons.fit /></button>
        </div>
        {state.canEdit && (
          <div className="panel zoom-box">
            <button className="icon-btn" aria-label="실행 취소" title="실행 취소 (Ctrl+Z)" disabled={!state.canUndo} onClick={() => editor.undo()}><Icons.undo /></button>
            <button className="icon-btn" aria-label="다시 실행" title="다시 실행 (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={() => editor.redo()}><Icons.redo /></button>
          </div>
        )}
      </div>
      <div className="bottom-right" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn panel-btn" aria-label="단축키" onClick={() => setDialog("help")}><Icons.help /></button>
      </div>

      {state.empty && state.status === "online" && state.canEdit && (
        <div className="welcome-hint">
          <div className="hint-title">무엇이든 그려 보세요 ✍️</div>
          <div className="hint-items">
            <span><kbd>S</kbd> 스티키 노트</span>
            <span><kbd>R</kbd> 사각형</span>
            <span><kbd>P</kbd> 펜</span>
            <span><kbd>T</kbd> 또는 더블클릭 → 글쓰기</span>
            <span>이미지는 붙여넣기 / 드래그</span>
          </div>
        </div>
      )}

      <ContextMenu editor={editor} state={state} />
      {state.toast && <div className="toast">{state.toast}</div>}
      {state.status === "deleted" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>이 보드는 삭제되었어요</h3>
            <div className="modal-actions"><button className="btn btn-primary" onClick={() => navigate("/")}>처음으로</button></div>
          </div>
        </div>
      )}
      {dialog === "share" && <ShareDialog meta={meta} onChange={setMeta} onClose={() => setDialog(null)} />}
      {dialog === "export" && <ExportDialog editor={editor} state={state} title={meta.title} onClose={() => setDialog(null)} />}
      {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
