import type { Console } from "../console";
import { byNewest, formatDate } from "../display";
import { ProjectManagement } from "./ProjectManagement";
import { DeployForm } from "./DeployForm";
import { Logs } from "./Logs";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { StatusBadge } from "./StatusBadge";
import { RefreshCw, LogOut, X } from "lucide-react";

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
        {state.notice && (
          <Alert
            variant={state.noticeError ? "destructive" : "default"}
            role="status"
            aria-live="polite"
            className="flex items-center justify-between"
          >
            <AlertDescription>{state.notice}</AlertDescription>
            <Button
              size="icon"
              variant="ghost"
              aria-label="알림 닫기"
              onClick={() => app.update({ notice: "" })}
            >
              <X />
            </Button>
          </Alert>
        )}
        <div className="flex items-center justify-between gap-4">
          <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">
            {project?.name || "프로젝트"}
          </h1>
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(state.busy)}
            onClick={() => void app.refresh()}
          >
            <RefreshCw />
            새로고침
          </Button>
        </div>
        <ProjectManagement app={app} />
        {!project ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              아직 프로젝트가 없습니다
            </CardContent>
          </Card>
        ) : (
          <>
            <section
              className="grid gap-4 sm:grid-cols-3"
              aria-label="프로젝트 요약"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">
                    배포 상태
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBadge
                    status={project.running ? "running" : latest?.status}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">
                    업로드된 파일
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xl font-semibold">
                  {project.artifacts.length}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    개
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">
                    최근 배포
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="truncate font-medium">
                    {latest?.version || "아직 없음"}
                  </p>
                  {latest && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(latest.startedAt)}
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-6">
                <DeployForm app={app} />
                <Logs app={app} />
              </div>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>배포 이력</CardTitle>
                  <Badge variant="secondary">{deployments.length}</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  {!deployments.length ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      배포 이력이 없습니다
                    </p>
                  ) : (
                    deployments.map((d) => (
                      <Button
                        key={d.id}
                        variant={
                          d.id === state.deploymentId ? "secondary" : "ghost"
                        }
                        className="h-auto w-full flex-col items-stretch gap-2 p-3 text-left"
                        aria-pressed={d.id === state.deploymentId}
                        disabled={Boolean(state.busy)}
                        onClick={() => app.selectDeployment(d)}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate">{d.version}</span>
                          <StatusBadge status={d.status} />
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(d.startedAt)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {project.artifacts.find((a) => a.id === d.artifactId)
                            ?.name || "배포 파일"}
                        </span>
                      </Button>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
