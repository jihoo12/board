import { useEffect, useMemo, useState } from "react";
import type { BoardSummary } from "../../shared/types";
import { api } from "../api";
import type { Session } from "../App";
import { navigate } from "../router";
import { buildTemplate, TEMPLATES } from "../templates";
import { Avatar } from "../ui/Avatar";
import { Icons } from "../ui/icons";

export function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "방금 전";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`;
  return new Date(t).toLocaleDateString("ko-KR");
}

const SHARE_LABEL = { private: "비공개", view: "보기 공유", edit: "편집 공유" } as const;

export function Dashboard({ session }: { session: Session }) {
  const user = session.user!;
  const [boards, setBoards] = useState<{ owned: BoardSummary[]; shared: BoardSummary[] } | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [userMenu, setUserMenu] = useState(false);

  const load = () => api.boards().then(setBoards).catch(() => setBoards({ owned: [], shared: [] }));
  useEffect(() => {
    load();
    document.title = "Inkboard";
    const close = () => {
      setMenuFor(null);
      setUserMenu(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const create = async (tid: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const t = TEMPLATES.find((x) => x.id === tid)!;
      const { id } = await api.createBoard(tid === "blank" ? "제목 없는 보드" : t.name, buildTemplate(t));
      navigate(`/b/${id}`);
    } finally {
      setBusy(false);
    }
  };

  const filter = (list: BoardSummary[]) => list.filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase()));
  const owned = useMemo(() => (boards ? filter(boards.owned) : []), [boards, q]);
  const shared = useMemo(() => (boards ? filter(boards.shared) : []), [boards, q]);

  const rename = async (b: BoardSummary) => {
    const title = prompt("보드 이름", b.title);
    if (title === null) return;
    await api.updateBoard(b.id, { title });
    load();
  };
  const remove = async (b: BoardSummary) => {
    if (!confirm(`"${b.title}" 보드를 삭제할까요? 되돌릴 수 없어요.`)) return;
    await api.deleteBoard(b.id);
    load();
  };
  const duplicate = async (b: BoardSummary) => {
    const { id } = await api.duplicateBoard(b.id);
    load();
    return id;
  };

  const card = (b: BoardSummary, mine: boolean) => (
    <div key={b.id} className="board-card" onClick={() => navigate(`/b/${b.id}`)}>
      <div className="thumb">
        {b.thumbnail ? <img src={b.thumbnail} alt="" loading="lazy" /> : <div className="thumb-empty">빈 보드</div>}
      </div>
      <div className="board-card-body">
        <div className="board-card-title" title={b.title}>{b.title}</div>
        <div className="board-card-meta">
          {mine ? (
            <span className={`badge badge-${b.share}`}>{SHARE_LABEL[b.share]}</span>
          ) : (
            <span className="badge">{b.ownerName}</span>
          )}
          <span>{timeAgo(b.updatedAt)}</span>
        </div>
        {mine && (
          <button
            className="icon-btn card-menu-btn"
            aria-label="메뉴"
            onClick={(e) => {
              e.stopPropagation();
              setMenuFor(menuFor === b.id ? null : b.id);
            }}
          >
            ⋯
          </button>
        )}
        {menuFor === b.id && (
          <div className="dropdown" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setMenuFor(null); rename(b); }}>이름 바꾸기</button>
            <button onClick={() => { setMenuFor(null); duplicate(b); }}>복제</button>
            <button className="danger" onClick={() => { setMenuFor(null); remove(b); }}>삭제</button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="logo"><img src="/favicon.svg" alt="" width={28} height={28} /> Inkboard</div>
        <input className="input search" placeholder="보드 검색…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="user-menu-wrap">
          <button className="user-chip" onClick={(e) => { e.stopPropagation(); setUserMenu(!userMenu); }}>
            <Avatar name={user.name} src={user.avatar} size={30} />
            <span className="user-name">{user.name}</span>
          </button>
          {userMenu && (
            <div className="dropdown right" onClick={(e) => e.stopPropagation()}>
              <div className="dropdown-info">
                <b>{user.name}</b>
                <span className="muted small">{user.email || `${user.provider} 계정`}</span>
              </div>
              <button
                onClick={async () => {
                  await api.logout();
                  await session.refresh();
                  navigate("/", true);
                }}
              >
                <Icons.logout /> 로그아웃
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="dash-main">
        <section>
          <h2>새로 시작하기</h2>
          <div className="templates">
            {TEMPLATES.map((t) => (
              <button key={t.id} className="template-card" disabled={busy} onClick={() => create(t.id)}>
                <span className="template-emoji">{t.emoji}</span>
                <b>{t.name}</b>
                <span className="muted small">{t.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>내 보드 {boards && <span className="count">{boards.owned.length}</span>}</h2>
          {!boards ? (
            <div className="spinner" />
          ) : owned.length ? (
            <div className="board-grid">{owned.map((b) => card(b, true))}</div>
          ) : (
            <div className="empty-state">
              {q ? "검색 결과가 없어요" : "아직 보드가 없어요. 위에서 하나 만들어 보세요! 👆"}
            </div>
          )}
        </section>

        {boards && shared.length > 0 && (
          <section>
            <h2>공유받은 보드</h2>
            <div className="board-grid">{shared.map((b) => card(b, false))}</div>
          </section>
        )}
      </main>
    </div>
  );
}
