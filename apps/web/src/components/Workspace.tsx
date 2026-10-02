import type { Console } from "../console";
import { byNewest, formatDate, statusDetails } from "../display";
import { Brand } from "./Brand";
import { ProjectManagement } from "./ProjectManagement";
import { DeployForm } from "./DeployForm";
import { Logs } from "./Logs";

export function Workspace({ app }: { app: Console }) {
  const { state, project } = app;
  const deployments = byNewest(project?.deployments || [], "startedAt");
  const latest = deployments[0];
  const [latestLabel, latestKind] = statusDetails(latest?.status);
  return (
    <div id="app-view" className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-caption">WORKSPACE</div>
        <div className="nav-label">
          <span aria-hidden="true">▦</span> 프로젝트{" "}
          <span className="count">{state.projects.length}</span>
        </div>
        <nav className="project-list" aria-label="프로젝트 선택">
          {state.projects.map((p) => (
            <button
              key={p.id}
              className={`project-nav${p.id === state.projectId ? " active" : ""}`}
              aria-current={p.id === state.projectId ? "page" : undefined}
              disabled={Boolean(state.busy)}
              onClick={() => void app.selectProject(p.id)}
            >
              <span>{p.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-avatar" aria-hidden="true">
            H
          </div>
          <div className="user-info">
            <strong>{state.user}</strong>
            <span>관리자</span>
          </div>
          <button
            className="icon-button"
            aria-label="로그아웃"
            disabled={Boolean(state.busy)}
            onClick={() => void app.logout()}
          >
            ↪
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            워크스페이스{" "}
            <span className="breadcrumb-slash" aria-hidden="true">
              /
            </span>
            <strong>{project?.name || "프로젝트"}</strong>
          </span>
          <span className="topbar-tag">
            <span className="dot" aria-hidden="true" />
            Bun Hoist
          </span>
        </header>
        <main className="main-content">
          {state.notice && (
            <div
              className={`notice${state.noticeError ? " error" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span>{state.notice}</span>
              <button
                aria-label="알림 닫기"
                onClick={() => app.update({ notice: "" })}
              >
                ×
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">DEPLOYMENT WORKSPACE</span>
              <h1>{project?.name || "프로젝트"}</h1>
              <p className="muted">
                {project
                  ? "배포 파일을 올리고 새 버전을 실행하세요"
                  : "등록된 프로젝트를 여기에서 관리할 수 있어요"}
              </p>
            </div>
            <button
              className="button secondary small"
              disabled={Boolean(state.busy)}
              onClick={() => void app.refresh()}
            >
              ↻ 새로고침
            </button>
          </div>
          <ProjectManagement app={app} />
          {!project ? (
            <section className="empty-state empty-projects">
              <div className="empty-icon" aria-hidden="true">
                ▦
              </div>
              <h2>아직 프로젝트가 없습니다</h2>
              <p>프로젝트를 등록하면 파일 업로드와 배포를 시작할 수 있어요</p>
            </section>
          ) : (
            <div id="project-content">
              <section className="overview-grid" aria-label="프로젝트 요약">
                <div className="stat-card">
                  <div className="stat-icon" aria-hidden="true">
                    ↗
                  </div>
                  <div>
                    <span className="stat-label">배포 상태</span>
                    <strong>{project.running ? "실행 중" : latestLabel}</strong>
                  </div>
                  <span
                    className={`status-dot ${project.running ? "running" : latestKind}`}
                  />
                </div>
                <div className="stat-card">
                  <div className="stat-icon" aria-hidden="true">
                    ▤
                  </div>
                  <div>
                    <span className="stat-label">업로드된 파일</span>
                    <strong>
                      {project.artifacts.length}
                      <small> 개</small>
                    </strong>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" aria-hidden="true">
                    ◷
                  </div>
                  <div>
                    <span className="stat-label">최근 배포</span>
                    <strong className="stat-version">
                      {latest?.version || "아직 없음"}
                    </strong>
                    <span className="stat-detail">
                      {latest && formatDate(latest.startedAt)}
                    </span>
                  </div>
                </div>
              </section>
              <div className="content-grid">
                <div className="main-column">
                  <DeployForm app={app} />
                  <Logs app={app} />
                </div>
                <section className="card history-card">
                  <div className="card-heading">
                    <div>
                      <h2>배포 이력</h2>
                      <span className="badge neutral">
                        {deployments.length}
                      </span>
                    </div>
                  </div>
                  <p className="history-intro muted">
                    항목을 선택하면 실행 로그를 볼 수 있어요
                  </p>
                  <div className="history-list">
                    {!deployments.length ? (
                      <div className="empty-state">
                        <div className="empty-icon">◷</div>
                        <h2>첫 배포를 기다리고 있어요</h2>
                        <p>배포가 시작되면 이곳에 기록됩니다</p>
                      </div>
                    ) : (
                      deployments.map((d) => {
                        const [label, kind] = statusDetails(d.status);
                        return (
                          <button
                            key={d.id}
                            className={`history-entry${d.id === state.deploymentId ? " active" : ""}`}
                            aria-pressed={d.id === state.deploymentId}
                            disabled={Boolean(state.busy)}
                            onClick={() => app.selectDeployment(d)}
                          >
                            <div className="history-head">
                              <span className="history-version">
                                {d.version}
                              </span>
                              <span className={`badge ${kind}`}>{label}</span>
                            </div>
                            <span className="history-date">
                              {formatDate(d.startedAt)}
                            </span>
                            <span className="history-artifact">
                              {project.artifacts.find(
                                (a) => a.id === d.artifactId,
                              )?.name || "배포 파일"}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
              <footer className="page-footer">
                <span>
                  <span className="dot" aria-hidden="true" />
                  필요할 때만 연결하고, 실행 중일 때만 갱신합니다
                </span>
                <span>BUILT FOR SIMPLE DEPLOYS</span>
              </footer>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
