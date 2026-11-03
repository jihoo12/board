import { useEffect, useState } from "react";
import type { User } from "../shared/types";
import { api, type Providers } from "./api";
import { BoardPage } from "./pages/BoardPage";
import { Dashboard } from "./pages/Dashboard";
import { Landing } from "./pages/Landing";
import { usePath } from "./router";

export interface Session {
  user: User | null;
  providers: Providers;
  refresh: () => Promise<void>;
}

export function App() {
  const path = usePath();
  const [session, setSession] = useState<Omit<Session, "refresh"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setSession(await api.me());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    refresh();
  }, []);

  if (error) {
    return (
      <div className="center-page">
        <p>서버에 연결할 수 없어요: {error}</p>
        <button className="btn" onClick={refresh}>다시 시도</button>
      </div>
    );
  }
  if (!session) return <div className="center-page"><div className="spinner" /></div>;
  const s: Session = { ...session, refresh };

  const m = path.match(/^\/b\/([A-Za-z0-9_-]+)/);
  if (m) return <BoardPage key={m[1]} boardId={m[1]} session={s} />;
  if (!s.user) return <Landing session={s} />;
  return <Dashboard session={s} />;
}
