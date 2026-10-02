import { useEffect, useRef, useState } from "react";
import type { Console } from "../console";
import { formatDate, isActive, statusDetails } from "../display";

export function Logs({ app }: { app: Console }) {
  const { state } = app;
  const [follow, setFollow] = useState(true);
  const terminal = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (follow && terminal.current)
      terminal.current.scrollTop = terminal.current.scrollHeight;
  }, [state.log, follow]);
  const [label, kind] = statusDetails(state.deployment?.status);
  return (
    <section className="card log-card">
      <div className="card-heading">
        <div>
          <span className="section-number">02</span>
          <h2>실행 로그</h2>
          <span className={`badge ${kind}`}>
            {state.deployment ? label : "선택된 배포 없음"}
          </span>
        </div>
        {isActive(state.deployment) && (
          <button
            id="cancel-button"
            className="button danger small"
            disabled={Boolean(state.busy || state.loadingLog)}
            onClick={() => void app.cancel()}
          >
            실행 취소
          </button>
        )}
      </div>
      <div className="terminal-top">
        <span className="terminal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          {state.deployment?.version
            ? `${state.deployment.version} · deployment.log`
            : "deployment.log"}
        </span>
        {isActive(state.deployment) && state.visible && (
          <span id="log-updating">
            <span className="pulse-dot" aria-hidden="true" />
            실시간
          </span>
        )}
      </div>
      <pre
        ref={terminal}
        id="log-output"
        className="terminal"
        tabIndex={0}
        aria-label="배포 실행 로그"
      >
        {state.log}
      </pre>
      <div className="log-footer">
        <span>
          {state.loadingLog
            ? "실행 로그를 불러오는 중…"
            : state.deployment
              ? `${state.deployment.finishedAt ? "종료 " + formatDate(state.deployment.finishedAt) : "시작 " + formatDate(state.deployment.startedAt)}${state.deployment.exitCode != null ? ` · 종료 코드 ${state.deployment.exitCode}` : ""}`
              : "실행 중일 때만 2초 간격으로 갱신됩니다"}
        </span>
        <label className="follow-label">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />{" "}
          로그 따라가기
        </label>
      </div>
    </section>
  );
}
