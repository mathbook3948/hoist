import { useEffect, useRef, useState } from "react";
import type { Console } from "../console";
import { byNewest, formatSize, isActive } from "../display";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldLabel, FieldDescription, FieldError } from "./ui/field";
import { Card, CardContent } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { Separator } from "./ui/separator";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Upload, Play, X } from "lucide-react";

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
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <ScrollArea
          type="auto"
          className="min-w-0 [&>[data-slot=scroll-area-viewport]]:max-h-[90svh] [&>[data-slot=scroll-area-viewport]>div]:block!"
        >
          <div className="space-y-5 p-6">
            <DialogHeader className="pr-10">
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
                <Field data-invalid={oversized}>
                  <FieldLabel htmlFor="artifact-file">
                    배포 파일 업로드
                  </FieldLabel>
                  <Card
                    id="drop-zone"
                    className={`gap-0 rounded-lg border-dashed p-5 shadow-none transition-colors ${dragging ? "border-ring bg-accent" : "bg-muted/20"} ${disabled ? "opacity-50" : ""}`}
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
                    <CardContent className="space-y-3 p-0">
                      <FieldDescription className="flex items-center gap-2">
                        <Upload className="size-4" aria-hidden="true" />
                        <span>파일을 끌어놓거나 선택하세요</span>
                      </FieldDescription>
                      <Input
                        ref={input}
                        id="artifact-file"
                        type="file"
                        disabled={disabled}
                        aria-invalid={oversized}
                        onChange={(e) =>
                          app.update({ file: e.target.files?.[0] || null })
                        }
                      />
                      {state.file && (
                        <FieldDescription className="truncate text-xs">
                          {state.file.name} · {formatSize(state.file.size)}
                        </FieldDescription>
                      )}
                    </CardContent>
                  </Card>
                  <div className="flex items-center justify-between gap-3">
                    {oversized ? (
                      <FieldError className="text-xs">
                        파일 크기가 최대{" "}
                        {formatSize(state.limits!.maxArtifactBytes)}를
                        초과합니다
                      </FieldError>
                    ) : (
                      <FieldDescription className="text-xs">
                        {state.limits &&
                          `파일당 최대 ${formatSize(state.limits.maxArtifactBytes)} · 전체 ${formatSize(state.limits.maxStorageBytes)}`}
                      </FieldDescription>
                    )}
                    <Button
                      id="upload-button"
                      variant="secondary"
                      type="submit"
                      disabled={disabled || !state.file || oversized}
                    >
                      {state.busy === "upload" && <Spinner />}
                      {state.busy === "upload" ? "업로드 중…" : "업로드"}
                    </Button>
                  </div>
                </Field>
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
                  <Field className="min-w-0">
                    <FieldLabel htmlFor="artifact-select">
                      배포할 파일
                    </FieldLabel>
                    <NativeSelect
                      id="artifact-select"
                      required
                      disabled={Boolean(
                        state.busy || !project?.artifacts.length,
                      )}
                      value={state.artifactId}
                      onChange={(e) =>
                        app.update({ artifactId: e.target.value })
                      }
                    >
                      {!project?.artifacts.length && (
                        <NativeSelectOption value="">
                          파일을 먼저 업로드하세요
                        </NativeSelectOption>
                      )}
                      {byNewest(project?.artifacts || [], "createdAt").map(
                        (a) => (
                          <NativeSelectOption key={a.id} value={a.id}>
                            {a.name} · {formatSize(a.size)}
                          </NativeSelectOption>
                        ),
                      )}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="version-input">버전</FieldLabel>
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
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button
                    type="button"
                    variant="secondary"
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
                  <Button
                    id="deploy-button"
                    type="submit"
                    disabled={!canDeploy}
                  >
                    {state.busy === "deploy" && <Spinner />}
                    {state.busy === "deploy" ? "배포 시작 중…" : "배포 시작"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </ScrollArea>
        <DialogClose asChild>
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-2 right-2"
            aria-label="모달 닫기"
            disabled={Boolean(state.busy)}
          >
            <X aria-hidden="true" />
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
