import { useEffect, useRef, useState } from "react";
import type { Console } from "../console";
import { byNewest, formatSize, isActive } from "../display";

export function DeployForm({ app }: { app: Console }) {
  const { state, project } = app;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!state.file && input.current) input.current.value = "";
  }, [state.file, state.projectId]);
  const running = Boolean(
    project?.running || project?.deployments.some(isActive),
  );
  const disabled = Boolean(
    state.busy || !project || running || state.serverBusy,
  );
  const oversized = Boolean(
    state.file &&
    state.limits &&
    state.file.size > state.limits.maxArtifactBytes,
  );
  const canDeploy = Boolean(
    !state.busy &&
    !state.serverBusy &&
    project &&
    !app.anyRunning &&
    state.artifactId &&
    state.version.trim(),
  );
  return (
    <section className="card deploy-card">
      <div className="card-heading">
        <div>
          <span className="section-number">01</span>
          <h2>새 배포</h2>
        </div>
        <span className="subtle-label">UPLOAD &amp; DEPLOY</span>
      </div>
      <form
        id="upload-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && state.file && !oversized) void app.upload();
        }}
      >
        <label className="input-label" htmlFor="artifact-file">
          배포 파일 업로드
        </label>
        <label
          id="drop-zone"
          className={`drop-zone${disabled ? " disabled" : ""}${dragging ? " drag-over" : ""}`}
          htmlFor="artifact-file"
          onClick={(e) => {
            if (disabled) e.preventDefault();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (disabled) return;
            const files = e.dataTransfer.files;
            if (files.length > 1)
              app.update({
                notice: "한 번에 파일 하나씩 업로드해 주세요",
                noticeError: true,
              });
            else if (files[0]) {
              app.update({ file: files[0] });
              if (input.current) input.current.value = "";
            }
          }}
        >
          <span className="upload-icon" aria-hidden="true">
            ↑
          </span>
          <strong>{state.file?.name || "파일을 끌어놓거나 선택하세요"}</strong>
          <span>
            {state.file
              ? formatSize(state.file.size)
              : "프로젝트에서 실행할 빌드 결과물"}
          </span>
          <span className="file-picker-link">파일 선택</span>
        </label>
        <input
          ref={input}
          id="artifact-file"
          className="visually-hidden"
          type="file"
          disabled={disabled}
          onChange={(e) => app.update({ file: e.target.files?.[0] || null })}
        />
        <div className="upload-actions">
          <span className="muted">
            {oversized
              ? `파일 크기가 최대 ${formatSize(state.limits!.maxArtifactBytes)}를 초과합니다`
              : state.file
                ? "선택한 파일을 서버에 업로드할 준비가 됐어요"
                : "파일 선택 후 서버에 업로드합니다"}
          </span>
          <button
            id="upload-button"
            className="button secondary small"
            type="submit"
            disabled={disabled || !state.file || oversized}
          >
            {state.busy === "upload" ? "업로드 중…" : "업로드"}
          </button>
        </div>
      </form>
      <div className="form-divider" />
      <p id="upload-limits" className="muted upload-limits">
        {state.limits &&
          `파일당 최대 ${formatSize(state.limits.maxArtifactBytes)} · 전체 보관 한도 ${formatSize(state.limits.maxStorageBytes)}`}
      </p>
      <form
        id="deploy-form"
        className="deploy-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canDeploy) void app.deploy();
        }}
      >
        <div className="form-grid">
          <div>
            <label htmlFor="artifact-select">배포할 파일</label>
            <select
              id="artifact-select"
              required
              disabled={Boolean(state.busy || !project?.artifacts.length)}
              value={state.artifactId}
              onChange={(e) => app.update({ artifactId: e.target.value })}
            >
              {!project?.artifacts.length && (
                <option value="">파일을 먼저 업로드하세요</option>
              )}
              {byNewest(project?.artifacts || [], "createdAt").map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatSize(a.size)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="version-input">버전</label>
            <input
              id="version-input"
              placeholder="예: v1.0.0"
              maxLength={128}
              autoComplete="off"
              required
              disabled={Boolean(state.busy || app.anyRunning)}
              value={state.version}
              onChange={(e) => app.update({ version: e.target.value })}
            />
          </div>
        </div>
        <div className="deploy-actions">
          <p className="muted">
            {running
              ? "현재 배포가 끝나면 다음 배포를 시작할 수 있어요"
              : app.anyRunning
                ? "다른 프로젝트의 배포가 끝나면 시작할 수 있어요"
                : "파일과 버전을 확인한 뒤 실행하세요"}
          </p>
          <button
            id="deploy-button"
            className="button primary"
            type="submit"
            disabled={!canDeploy}
          >
            {state.busy === "deploy" ? "배포 시작 중…" : "↗ 배포 시작"}
          </button>
        </div>
      </form>
    </section>
  );
}
