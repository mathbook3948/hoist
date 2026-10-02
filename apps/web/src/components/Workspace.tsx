import type { Console } from "../console";
import { byNewest, formatDate, formatDuration, formatSize } from "../display";
import { ProjectManagement } from "./ProjectManagement";
import { DeployForm } from "./DeployForm";
import { Logs } from "./Logs";
import { Button } from "./ui/button";
import { Empty, EmptyHeader, EmptyDescription } from "./ui/empty";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

import { StatusBadge } from "./StatusBadge";
import { ArrowLeft, LogOut } from "lucide-react";
import { DataTable } from "./DataTable";

export function Workspace({ app }: { app: Console }) {
  const { state, project } = app;
  const deployments = byNewest(project?.deployments || [], "startedAt");
  const latest = deployments[0];
  return (
    <div className="min-h-svh">
      <main className="mx-auto w-full max-w-7xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            {state.projectId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="secondary" size="icon">
                    <a
                      href="/"
                      aria-label="프로젝트 목록"
                      onClick={(e) => {
                        if (
                          e.button === 0 &&
                          !e.ctrlKey &&
                          !e.metaKey &&
                          !e.shiftKey &&
                          !e.altKey
                        ) {
                          e.preventDefault();
                          app.selectProject(null);
                        }
                      }}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>목록으로</TooltipContent>
              </Tooltip>
            )}
            <h1 className="h-9 truncate text-2xl leading-9 font-semibold tracking-tight">
              {project?.name ||
                (state.projectId ? "프로젝트를 찾을 수 없습니다" : "프로젝트")}
            </h1>
            {project && (
              <StatusBadge
                status={project.running ? "running" : latest?.status}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {(!state.projectId || project) && (
              <ProjectManagement
                key={`management-${state.projectId || "list"}`}
                app={app}
              />
            )}
            {project && <DeployForm key={project.id} app={app} />}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="로그아웃"
                  disabled={Boolean(state.busy)}
                  onClick={() => void app.logout()}
                >
                  <LogOut aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{state.user} · 로그아웃</TooltipContent>
            </Tooltip>
          </div>
        </header>
        {state.loadingProjects ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Spinner />
            프로젝트를 불러오는 중…
          </p>
        ) : !state.projectId ? (
          <DataTable
            label="프로젝트 목록"
            className="min-w-5xl"
            rows={state.projects.map((p) => ({
              ...p,
              recent: byNewest(p.deployments, "startedAt")[0],
            }))}
            rowKey={(p) => p.id}
            onRowClick={(p) => app.selectProject(p.id)}
            disabled={Boolean(state.busy)}
            emptyMessage="아직 프로젝트가 없습니다"
            columns={[
              {
                id: "name",
                header: "이름",
                className: "w-60",
                cell: (p) => (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={`/${encodeURIComponent(p.id)}`}
                        className="inline-block max-w-full truncate rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={(e) => {
                          if (
                            e.button === 0 &&
                            !e.ctrlKey &&
                            !e.metaKey &&
                            !e.shiftKey &&
                            !e.altKey
                          ) {
                            e.preventDefault();
                            app.selectProject(p.id);
                          }
                        }}
                      >
                        {p.name}
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>{p.name}</TooltipContent>
                  </Tooltip>
                ),
              },
              {
                id: "version",
                header: "최근 버전",
                cell: (p) => (
                  <span className="block truncate">
                    {p.recent?.version || "-"}
                  </span>
                ),
              },
              {
                id: "status",
                header: "배포 상태",
                cell: (p) => (
                  <StatusBadge
                    status={p.running ? "running" : p.recent?.status}
                  />
                ),
              },
              {
                id: "duration",
                header: "소요 시간",
                className: "tabular-nums",
                cell: (p) => (p.recent ? formatDuration(p.recent) : "-"),
              },
              {
                id: "storage",
                header: "보관 용량",
                className: "tabular-nums",
                cell: (p) =>
                  formatSize(p.artifacts.reduce((sum, a) => sum + a.size, 0)),
              },
              {
                id: "started",
                header: "최근 배포 시각",
                className: "tabular-nums",
                cell: (p) => (p.recent ? formatDate(p.recent.startedAt) : "-"),
              },
            ]}
          />
        ) : !project ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyDescription>
                존재하지 않거나 삭제된 프로젝트입니다.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <DataTable
              label="배포 이력"
              rows={deployments}
              rowKey={(d) => d.id}
              onRowClick={app.selectDeployment}
              disabled={Boolean(state.busy)}
              selectedKey={state.deploymentId}
              emptyMessage="배포 이력이 없습니다. 새 배포에서 파일과 버전을 선택하세요."
              columns={[
                {
                  id: "version",
                  header: "버전",
                  className: "w-40",
                  cell: (d) => (
                    <Button
                      variant="secondary"
                      className="max-w-full justify-start"
                      aria-pressed={d.id === state.deploymentId}
                      disabled={Boolean(state.busy)}
                      onClick={() => app.selectDeployment(d)}
                    >
                      <span className="truncate">{d.version}</span>
                    </Button>
                  ),
                },
                {
                  id: "status",
                  header: "상태",
                  className: "w-28",
                  cell: (d) => <StatusBadge status={d.status} />,
                },
                {
                  id: "artifact",
                  header: "배포 파일",
                  cell: (d) => (
                    <span className="block truncate">
                      {project.artifacts.find((a) => a.id === d.artifactId)
                        ?.name || "보관 종료된 파일"}
                    </span>
                  ),
                },
                {
                  id: "started",
                  header: "시작 시각",
                  className: "w-44 tabular-nums",
                  cell: (d) => formatDate(d.startedAt),
                },
                {
                  id: "duration",
                  header: "소요 시간",
                  className: "w-28 tabular-nums",
                  cell: (d) => formatDuration(d),
                },
              ]}
            />
            {state.deploymentId && <Logs app={app} />}
          </>
        )}
      </main>
    </div>
  );
}
