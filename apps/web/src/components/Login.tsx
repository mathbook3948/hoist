import { useState, type FormEvent } from "react";
import type { Console } from "../console";
import { Brand } from "./Brand";

export function Login({ app }: { app: Console }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await app.login(username, password);
    } finally {
      setPassword("");
    }
  }
  return (
    <section id="login-view" className="login-view">
      <div className="login-story">
        <Brand />
        <div className="story-copy">
          <span className="eyebrow">FROM BUILD TO LIVE</span>
          <h1>
            다음 배포를,
            <br />
            조금 더 가볍게.
          </h1>
          <p>
            파일 업로드부터 실행 로그까지.
            <br />
            프로젝트의 배포를 한곳에서 관리하세요.
          </p>
        </div>
        <span className="story-foot">Simple by design. Powered by Bun.</span>
      </div>
      <main className="login-main">
        <form id="login-form" className="login-card" onSubmit={submit}>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Hoist 로그인</h2>
          <p className="muted">관리자 계정으로 시작하세요</p>
          <label htmlFor="username">사용자 이름</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            required
            maxLength={64}
            placeholder="사용자 이름 입력"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label htmlFor="password">비밀번호</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="비밀번호 입력"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {app.state.loginError && (
            <p id="login-error" className="field-error" role="alert">
              {app.state.loginError}
            </p>
          )}
          <button
            id="login-button"
            className="button primary full"
            type="submit"
            disabled={Boolean(app.state.busy)}
          >
            {app.state.busy === "login" ? "로그인 중…" : "로그인 →"}
          </button>
          <p className="login-note">서버에 설정된 관리자 계정을 사용합니다</p>
        </form>
      </main>
    </section>
  );
}
