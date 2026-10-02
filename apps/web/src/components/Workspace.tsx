import type { Console } from "../console";
import { byNewest, formatDate, formatDuration } from "../display";
import { ProjectManagement } from "./ProjectManagement";
import { DeployForm } from "./DeployForm";
import { Logs } from "./Logs";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { StatusBadge } from "./StatusBadge";
import { LogOut } from "lucide-react";

export function Workspace({ app }: { app: Console }) {
  const { state, project } = app;
  const deployments = byNewest(project?.deployments || [], "startedAt");
  const latest = deployments[0];
  return (
    <div className="min-h-svh md:grid md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="flex flex-col border-b bg-muted/20 p-4 md:sticky md:top-0 md:h-svh md:border-r md:border-b-0">
        <div className="mb-4 flex items-center justify-between px-2 text-sm font-medium">
          프로젝트<Badge variant="secondary">{state.projects.length}</Badge>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto md:flex-1 md:flex-col"
          aria-label="프로젝트 선택"
        >
          {state.projects.map((p) => (
            <Button
              key={p.id}
              variant={p.id === state.projectId ? "secondary" : "ghost"}
              className="justify-start md:w-full"
              aria-current={p.id === state.projectId ? "page" : undefined}
              disabled={Boolean(state.busy)}
              onClick={() => void app.selectProject(p.id)}
            >
              <span className="truncate">{p.name}</span>
            </Button>
          ))}
        </nav>
        <Separator className="my-4" />
        <div className="flex items-center justify-between gap-2 px-2">
          <span className="truncate text-sm text-muted-foreground">
            {state.user}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="로그아웃"
            disabled={Boolean(state.busy)}
            onClick={() => void app.logout()}
          >
            <LogOut />
          </Button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-7xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {project?.name || "프로젝트"}
            </h1>
            {project && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <StatusBadge
                  status={project.running ? "running" : latest?.status}
                />
                <span>최근 배포 {latest?.version || "없음"}</span>
                <span>· 실행 제한 {project.timeoutSeconds}초</span>
              </div>
            )}
          </div>
          {project && <DeployForm key={project.id} app={app} />}
        </header>
        <ProjectManagement app={app} />
        {!project ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              아직 프로젝트가 없습니다
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>배포 이력</CardTitle>
                <Badge variant="secondary">{deployments.length}</Badge>
              </CardHeader>
              <CardContent>
                {!deployments.length ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    배포 이력이 없습니다. 새 배포에서 파일과 버전을 선택하세요.
                  </p>
                ) : (
                  <div
                    className="space-y-1"
                    role="group"
                    aria-label="배포 이력"
                  >
                    <div
                      className="hidden grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)_150px_100px] gap-4 border-b px-3 pb-3 text-xs text-muted-foreground lg:grid"
                      aria-hidden="true"
                    >
                      <span>버전</span>
                      <span>상태</span>
                      <span>배포 파일</span>
                      <span>시작 시각</span>
                      <span>소요 시간</span>
                    </div>
                    {deployments.map((d) => (
                      <Button
                        key={d.id}
                        variant={
                          d.id === state.deploymentId ? "secondary" : "ghost"
                        }
                        className="grid h-auto w-full grid-cols-2 gap-2 p-3 text-left lg:grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)_150px_100px] lg:gap-4"
                        aria-pressed={d.id === state.deploymentId}
                        disabled={Boolean(state.busy)}
                        onClick={() => app.selectDeployment(d)}
                      >
                        <span className="truncate font-medium">
                          {d.version}
                        </span>
                        <span>
                          <StatusBadge status={d.status} />
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {project.artifacts.find((a) => a.id === d.artifactId)
                            ?.name || "보관 종료된 파일"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(d.startedAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(d)}
                        </span>
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Logs app={app} />
          </>
        )}
      </main>
    </div>
  );
}
