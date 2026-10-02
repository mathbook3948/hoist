import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  defaultDeployScript,
  type Project,
  type ProjectInput,
} from "../../../server/src/models";
import type { Console } from "../console";
import { Button } from "./ui/button";
import { Plus, Settings, Archive } from "lucide-react";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "./ui/alert-dialog";

export function ProjectManagement({ app }: { app: Console }) {
  const [editor, setEditor] = useState<{
    input: ProjectInput;
    editingId?: string;
    loading?: boolean;
    loadError?: string;
  } | null>(null);
  const [removing, setRemoving] = useState<Project | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    setEditor(null);
    setRemoving(null);
  }, [app.state.projectId]);
  function open(project?: Project) {
    app.update({ notice: "" });
    editorTrigger.current = project ? editButton.current : addButton.current;
    setRemoving(null);
    setEditor({
      input: project
        ? {
            name: project.name,
            scriptContent: "",
            timeoutSeconds: project.timeoutSeconds,
          }
        : { name: "", scriptContent: defaultDeployScript, timeoutSeconds: 300 },
      editingId: project?.id,
      loading: Boolean(project),
    });
  }
  useEffect(() => {
    const id = editor?.editingId;
    if (!id) return;
    let disposed = false;
    void app
      .getProjectScript(id)
      .then((result) => {
        if (!disposed)
          setEditor((current) =>
            current?.editingId === id
              ? {
                  ...current,
                  loading: false,
                  input: {
                    ...current.input,
                    scriptContent: result.scriptContent,
                  },
                }
              : current,
          );
      })
      .catch((error) => {
        if (!disposed)
          setEditor((current) =>
            current?.editingId === id
              ? {
                  ...current,
                  loading: false,
                  loadError:
                    error instanceof Error
                      ? error.message
                      : "스크립트를 불러올 수 없습니다",
                }
              : current,
          );
      });
    return () => {
      disposed = true;
    };
  }, [editor?.editingId]);
  function field(key: keyof ProjectInput, value: string | number) {
    setEditor(
      (previous) =>
        previous && { ...previous, input: { ...previous.input, [key]: value } },
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || editor.loading || editor.loadError || app.managementBusy)
      return;
    const input = {
      ...editor.input,
      name: editor.input.name.trim(),
    };
    if (await app.saveProject(input, editor.editingId)) setEditor(null);
  }
  const error =
    app.state.notice && app.state.noticeError ? (
      <Alert variant="destructive">
        <AlertDescription>{app.state.notice}</AlertDescription>
      </Alert>
    ) : null;
  return (
    <section
      aria-label="프로젝트 관리"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground">
        {app.managementBusy
          ? "업로드·배포 중에는 프로젝트 설정을 변경할 수 없습니다"
          : "프로젝트 관리"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={addButton}
          id="project-add-button"
          variant="outline"
          size="icon-sm"
          aria-label="등록"
          title="프로젝트 등록"
          disabled={app.managementBusy}
          onClick={() => open()}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          ref={editButton}
          id="project-edit-button"
          variant="outline"
          size="icon-sm"
          aria-label="설정"
          title="프로젝트 설정"
          disabled={app.managementBusy || !app.project}
          onClick={() => open(app.project)}
        >
          <Settings aria-hidden="true" />
        </Button>
        <Button
          ref={removeButton}
          id="project-remove-button"
          variant="ghost"
          size="icon-sm"
          aria-label="등록 해제"
          title="프로젝트 등록 해제"
          className="text-destructive hover:text-destructive"
          disabled={app.managementBusy || !app.project}
          onClick={() => {
            app.update({ notice: "" });
            setEditor(null);
            setRemoving(app.project || null);
          }}
        >
          <Archive aria-hidden="true" />
        </Button>
      </div>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(isOpen) => {
          if (!isOpen && !app.state.busy) setEditor(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[90svh] overflow-y-auto sm:max-w-3xl"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            nameInput.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            editorTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editor?.editingId ? "프로젝트 설정" : "프로젝트 등록"}
            </DialogTitle>
            <DialogDescription>
              배포 스크립트와 실행 제한 시간을 설정합니다.
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <form id="project-form" className="space-y-4" onSubmit={save}>
              <div className="space-y-2">
                <Label htmlFor="project-name-input">프로젝트 이름</Label>
                <Input
                  ref={nameInput}
                  id="project-name-input"
                  required
                  maxLength={100}
                  autoComplete="off"
                  value={editor.input.name}
                  disabled={app.managementBusy}
                  onChange={(e) => field("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-script-input">배포 스크립트</Label>
                <Textarea
                  id="project-script-input"
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  wrap="off"
                  className="h-72 min-h-48 field-sizing-fixed font-mono text-sm leading-relaxed"
                  value={editor.input.scriptContent}
                  disabled={
                    app.managementBusy ||
                    editor.loading ||
                    Boolean(editor.loadError)
                  }
                  onChange={(e) => field("scriptContent", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {editor.loading
                    ? "스크립트를 불러오는 중…"
                    : "sh · $1: 업로드 파일 경로 · $2: 버전"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-timeout-input">
                  배포 실행 제한 시간 (초)
                </Label>
                <Input
                  id="project-timeout-input"
                  type="number"
                  required
                  min={1}
                  max={3600}
                  step={1}
                  value={editor.input.timeoutSeconds}
                  disabled={app.managementBusy}
                  onChange={(e) =>
                    field("timeoutSeconds", Number(e.target.value))
                  }
                />
              </div>
              {editor.loadError && (
                <Alert variant="destructive">
                  <AlertDescription>{editor.loadError}</AlertDescription>
                </Alert>
              )}
              {error}
              <DialogFooter>
                <Button
                  variant="outline"
                  type="button"
                  disabled={Boolean(app.state.busy)}
                  onClick={() => setEditor(null)}
                >
                  닫기
                </Button>
                <Button
                  id="project-save-button"
                  type="submit"
                  disabled={
                    app.managementBusy ||
                    editor.loading ||
                    Boolean(editor.loadError)
                  }
                >
                  저장
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(isOpen) => {
          if (!isOpen && !app.state.busy) setRemoving(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            removeButton.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>프로젝트 등록 해제 확인</AlertDialogTitle>
            <AlertDialogDescription>
              ‘{removing?.name}’ 프로젝트의 등록을 해제할까요? 기존 파일과 배포
              이력은 보관됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(app.state.busy)}>
              취소
            </AlertDialogCancel>
            <Button
              id="project-remove-submit"
              variant="destructive"
              disabled={app.managementBusy}
              onClick={async () => {
                if (removing && (await app.removeProject(removing.id)))
                  setRemoving(null);
              }}
            >
              등록 해제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
