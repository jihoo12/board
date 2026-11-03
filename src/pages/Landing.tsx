import { useState } from "react";
import type { Session } from "../App";
import { Icons } from "../ui/icons";

export function LoginButtons({ session, returnTo }: { session: Session; returnTo?: string }) {
  const [name, setName] = useState("");
  const p = session.providers;
  const ret = encodeURIComponent(returnTo ?? location.pathname);
  const none = !p.github && !p.google && !p.dev;
  return (
    <div className="login-buttons">
      {p.github && (
        <a className="btn btn-lg btn-dark" href={`/auth/github?return=${ret}`}>
          <Icons.github /> GitHub로 계속하기
        </a>
      )}
      {p.google && (
        <a className="btn btn-lg btn-light" href={`/auth/google?return=${ret}`}>
          <Icons.google /> Google로 계속하기
        </a>
      )}
      {p.dev && (
        <form
          className="dev-login"
          onSubmit={(e) => {
            e.preventDefault();
            location.href = `/auth/dev?name=${encodeURIComponent(name || "Guest")}&return=${ret}`;
          }}
        >
          <input className="input" placeholder="이름 (개발용 로그인)" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <button className="btn btn-lg" type="submit">입장</button>
        </form>
      )}
      {none && (
        <p className="muted small">
          로그인 방법이 설정되지 않았어요. <code>GITHUB_CLIENT_ID</code> / <code>GOOGLE_CLIENT_ID</code> 비밀값을 설정하거나,
          로컬에서는 <code>.dev.vars</code>에 <code>DEV_LOGIN=true</code>를 넣어 주세요.
        </p>
      )}
    </div>
  );
}

const FEATURES = [
  { icon: "✏️", title: "손그림 느낌", text: "도형, 화살표, 펜 — 스케치하듯 자유롭게" },
  { icon: "🗒️", title: "스티키 노트", text: "아이디어를 붙이고 옮기고 묶기" },
  { icon: "🖼️", title: "프레임 & 정렬", text: "스마트 가이드, 정렬, 그룹, 프레임으로 정리" },
  { icon: "👥", title: "실시간 협업", text: "같이 보는 사람의 커서와 레이저 포인터까지" },
  { icon: "☁️", title: "자동 저장", text: "Cloudflare에 바로바로 저장돼요" },
  { icon: "🔗", title: "링크 공유", text: "보기 전용 또는 편집 가능 링크로 공유" },
];

export function Landing({ session }: { session: Session }) {
  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true">
        <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
          <path className="doodle d1" d="M90 160 C 180 60, 300 60, 360 150 S 520 260, 600 170" />
          <path className="doodle d2" d="M820 620 q 60 -80 140 -20 t 140 -10" />
          <rect className="doodle d3" x="900" y="120" width="190" height="120" rx="14" />
          <circle className="doodle d4" cx="200" cy="610" r="70" />
          <path className="doodle d5" d="M620 700 L 760 560 M 720 560 h 40 v 40" />
        </svg>
        <div className="floating-note n1">아이디어 💡</div>
        <div className="floating-note n2">할 일 ✅</div>
        <div className="floating-note n3">회의 메모 📝</div>
      </div>
      <main className="landing-main">
        <div className="logo-big">
          <img src="/favicon.svg" alt="" width={56} height={56} /> Inkboard
        </div>
        <h1>
          생각을 <span className="hl">그리고</span>, 붙이고, <span className="hl2">함께</span> 다듬는 곳
        </h1>
        <p className="lead">스케치, 다이어그램, 스티키 노트, 회의 메모까지 — 무한 캔버스 위에서 뭐든지.</p>
        <LoginButtons session={session} returnTo="/" />
        <div className="features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <div>
                <b>{f.title}</b>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
