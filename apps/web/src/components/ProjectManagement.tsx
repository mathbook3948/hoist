import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Project } from "../../../server/src/models";
import type { Console } from "../console";

export function ProjectManagement({ app }: { app: Console }) {
  const [editor, setEditor] = useState<{
    input: Project;
    editingId?: string;
  } | null>(null);
  const [removing, setRemoving] = useState<Project | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const removeCancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setEditor(null);
    setRemoving(null);
  }, [app.state.projectId]);
  useEffect(() => {
    if (editor) nameInput.current?.focus();
  }, [Boolean(editor)]);
  useEffect(() => {
    if (removing) removeCancel.current?.focus();
  }, [Boolean(removing)]);
  function open(project?: Project) {
    setRemoving(null);
    setEditor({
      input: project
        ? {
            id: project.id,
            name: project.name,
            script: project.script,
            timeoutSeconds: project.timeoutSeconds,
          }
        : { id: "", name: "", script: "", timeoutSeconds: 300 },
      editingId: project?.id,
    });
  }
  function field(key: keyof Project, value: string | number) {
    setEditor(
      (previous) =>
        previous && { ...previous, input: { ...previous.input, [key]: value } },
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || app.managementBusy) return;
    const input = {
      ...editor.input,
      id: editor.input.id.trim(),
      name: editor.input.name.trim(),
      script: editor.input.script.trim(),
    };
    if (await app.saveProject(input, editor.editingId)) setEditor(null);
  }
  return (
    <section className="card project-management" aria-label="프로젝트 관리">
      <div className="project-management-bar">
        <div>
          <h2>프로젝트 관리</h2>
          <p className="muted">
            {app.managementBusy
              ? "업로드·배포가 끝난 뒤 프로젝트 설정을 변경할 수 있어요"
              : "프로젝트를 등록하거나 선택한 프로젝트의 설정을 관리하세요"}
          </p>
        </div>
        <div className="project-management-actions">
          <button
            id="project-add-button"
            className="button secondary small"
            disabled={app.managementBusy}
            onClick={() => open()}
          >
            + 등록
          </button>
          <button
            id="project-edit-button"
            className="button secondary small"
            disabled={app.managementBusy || !app.project}
            onClick={() => open(app.project)}
          >
            설정
          </button>
          <button
            id="project-remove-button"
            className="button secondary small danger-text"
            disabled={app.managementBusy || !app.project}
            onClick={() => {
              setEditor(null);
              setRemoving(app.project || null);
            }}
          >
            등록 해제
          </button>
        </div>
      </div>
      {editor && (
        <div id="project-editor" className="project-editor">
          <h2>{editor.editingId ? "프로젝트 설정" : "프로젝트 등록"}</h2>
          <form id="project-form" onSubmit={save}>
            <div className="project-form-grid">
              <div>
                <label htmlFor="project-id-input">프로젝트 ID</label>
                <input
                  id="project-id-input"
                  required
                  maxLength={64}
                  pattern="[a-zA-Z0-9_-]{1,64}"
                  autoComplete="off"
                  placeholder="예: my-service"
                  value={editor.input.id}
                  readOnly={Boolean(editor.editingId)}
                  disabled={app.managementBusy}
                  onChange={(e) => field("id", e.target.value)}
                />
                <p className="muted">
                  영문·숫자·밑줄·하이픈을 사용하며 등록 후 변경할 수 없습니다
                </p>
              </div>
              <div>
                <label htmlFor="project-name-input">프로젝트 이름</label>
                <input
                  ref={nameInput}
                  id="project-name-input"
                  required
                  maxLength={100}
                  autoComplete="off"
                  placeholder="예: 내 서비스"
                  value={editor.input.name}
                  disabled={app.managementBusy}
                  onChange={(e) => field("name", e.target.value)}
                />
              </div>
              <div className="project-script-field">
                <label htmlFor="project-script-input">
                  서버의 배포 스크립트 경로
                </label>
                <input
                  id="project-script-input"
                  required
                  autoComplete="off"
                  placeholder="/opt/hoist/scripts/deploy.sh"
                  value={editor.input.script}
                  disabled={app.managementBusy}
                  onChange={(e) => field("script", e.target.value)}
                />
                <p className="muted">
                  서버에 미리 만들어 둔 스크립트의 절대 경로를 입력하세요
                </p>
              </div>
              <div>
                <label htmlFor="project-timeout-input">
                  배포 실행 제한 시간 (초)
                </label>
                <input
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
            </div>
            <div className="project-management-actions">
              <button
                className="button secondary small"
                type="button"
                disabled={Boolean(app.state.busy)}
                onClick={() => setEditor(null)}
              >
                닫기
              </button>
              <button
                id="project-save-button"
                className="button primary small"
                type="submit"
                disabled={app.managementBusy}
              >
                저장
              </button>
            </div>
          </form>
        </div>
      )}
      {removing && (
        <div
          id="project-remove-confirm"
          className="project-editor"
          role="region"
          aria-label="프로젝트 등록 해제 확인"
        >
          <p>
            ‘{removing.name}’ 프로젝트의 등록을 해제할까요? 기존 파일과 배포
            이력은 보관되며, 같은 ID로 다시 등록하면 복원됩니다.
          </p>
          <div className="project-management-actions">
            <button
              ref={removeCancel}
              className="button secondary small"
              disabled={Boolean(app.state.busy)}
              onClick={() => setRemoving(null)}
            >
              취소
            </button>
            <button
              id="project-remove-submit"
              className="button secondary small danger-text"
              disabled={app.managementBusy}
              onClick={async () => {
                if (await app.removeProject(removing.id)) setRemoving(null);
              }}
            >
              등록 해제
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
