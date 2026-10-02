import { useEffect, useRef, useState } from "react";
import type { Console } from "../console";
import { byNewest, formatSize, isActive } from "../display";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { Separator } from "./ui/separator";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Upload, Play } from "lucide-react";

export function DeployForm({ app }: { app: Console }) {
  const { state, project } = app;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [state.projectId]);
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (state.busy) return;
        setOpen(next);
        app.update({ notice: "", noticeError: false });
      }}
    >
      <DialogTrigger asChild>
        <Button
          disabled={Boolean(state.busy || state.serverBusy || app.anyRunning)}
        >
          <Play />새 배포
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!state.busy}
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>새 배포</DialogTitle>
          <DialogDescription>
            {project?.name}에 배포할 파일과 버전을 선택하세요.
          </DialogDescription>
        </DialogHeader>
        {state.notice && state.noticeError && (
          <Alert variant="destructive">
            <AlertDescription>{state.notice}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-5">
          <form
            id="upload-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!disabled && state.file && !oversized) void app.upload();
            }}
          >
            <Label htmlFor="artifact-file">배포 파일 업로드</Label>
            <div
              id="drop-zone"
              className={`rounded-lg border border-dashed p-5 transition-colors ${dragging ? "border-ring bg-accent" : "bg-muted/20"} ${disabled ? "opacity-50" : ""}`}
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
              <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Upload className="size-4" aria-hidden="true" />
                <span>파일을 끌어놓거나 선택하세요</span>
              </div>
              <Input
                ref={input}
                id="artifact-file"
                type="file"
                disabled={disabled}
                onChange={(e) =>
                  app.update({ file: e.target.files?.[0] || null })
                }
              />
              {state.file && (
                <p className="mt-2 truncate text-xs text-muted-foreground">
                  {state.file.name} · {formatSize(state.file.size)}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p
                className={`text-xs ${oversized ? "text-destructive" : "text-muted-foreground"}`}
              >
                {oversized
                  ? `파일 크기가 최대 ${formatSize(state.limits!.maxArtifactBytes)}를 초과합니다`
                  : state.limits &&
                    `파일당 최대 ${formatSize(state.limits.maxArtifactBytes)} · 전체 ${formatSize(state.limits.maxStorageBytes)}`}
              </p>
              <Button
                id="upload-button"
                variant="outline"
                type="submit"
                disabled={disabled || !state.file || oversized}
              >
                {state.busy === "upload" ? "업로드 중…" : "업로드"}
              </Button>
            </div>
          </form>
          <Separator />
          <form
            id="deploy-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canDeploy)
                void app.deploy().then((ok) => {
                  if (ok) setOpen(false);
                });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2 [&>[data-slot=native-select-wrapper]]:w-full">
                <Label htmlFor="artifact-select">배포할 파일</Label>
                <NativeSelect
                  id="artifact-select"
                  required
                  disabled={Boolean(state.busy || !project?.artifacts.length)}
                  value={state.artifactId}
                  onChange={(e) => app.update({ artifactId: e.target.value })}
                >
                  {!project?.artifacts.length && (
                    <NativeSelectOption value="">
                      파일을 먼저 업로드하세요
                    </NativeSelectOption>
                  )}
                  {byNewest(project?.artifacts || [], "createdAt").map((a) => (
                    <NativeSelectOption key={a.id} value={a.id}>
                      {a.name} · {formatSize(a.size)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="version-input">버전</Label>
                <Input
                  id="version-input"
                  placeholder="v1.0.0"
                  maxLength={128}
                  autoComplete="off"
                  required
                  disabled={Boolean(state.busy || app.anyRunning)}
                  value={state.version}
                  onChange={(e) => app.update({ version: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(state.busy)}
                onClick={() => setOpen(false)}
              >
                닫기
              </Button>
              {app.anyRunning && (
                <p className="text-xs text-muted-foreground">
                  진행 중인 배포가 끝나면 시작할 수 있습니다
                </p>
              )}
              <Button id="deploy-button" type="submit" disabled={!canDeploy}>
                {state.busy === "deploy" ? "배포 시작 중…" : "배포 시작"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
