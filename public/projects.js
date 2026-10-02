import { project } from "./state.js";
import { $ } from "./render.js";

export function bindProjectManagement({ api, view, action, selectProject }) {
  const { showNotice, renderControls } = view;
  let editingId = null;
  let removingId = null;

  function close() {
    $("project-editor").hidden = true;
    $("project-remove-confirm").hidden = true;
    editingId = null;
    removingId = null;
  }

  function open(selected = null) {
    close();
    editingId = selected?.id || null;
    $("project-editor-title").textContent = selected
      ? "프로젝트 설정"
      : "프로젝트 등록";
    $("project-id-input").value = selected?.id || "";
    $("project-id-input").readOnly = Boolean(selected);
    $("project-name-input").value = selected?.name || "";
    $("project-script-input").value = selected?.script || "";
    $("project-timeout-input").value = selected?.timeoutSeconds || 300;
    $("project-editor").hidden = false;
    renderControls();
    $("project-name-input").focus();
  }

  $("project-add-button").addEventListener("click", () => {
    if (!$("project-add-button").disabled) open();
  });
  $("project-edit-button").addEventListener("click", () => {
    if (!$("project-edit-button").disabled && project()) open(project());
  });
  $("project-cancel-button").addEventListener("click", close);
  $("project-remove-cancel").addEventListener("click", close);

  $("project-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("project-save-button").disabled) return;
    const input = {
      id: $("project-id-input").value.trim(),
      name: $("project-name-input").value.trim(),
      script: $("project-script-input").value.trim(),
      timeoutSeconds: Number($("project-timeout-input").value),
    };
    const id = editingId;
    void action(async () => {
      await api(
        id ? `/api/projects/${encodeURIComponent(id)}` : "/api/projects",
        {
          method: id ? "PUT" : "POST",
          json: input,
        },
      );
      close();
      await selectProject(input.id, true);
      showNotice(id ? "프로젝트 설정을 저장했어요" : "프로젝트를 등록했어요");
    });
  });

  $("project-remove-button").addEventListener("click", () => {
    if ($("project-remove-button").disabled || !project()) return;
    const selected = project();
    close();
    removingId = selected.id;
    $("project-remove-description").textContent =
      `‘${selected.name}’ 프로젝트의 등록을 해제할까요? 기존 파일과 배포 이력은 보관되며, 같은 ID로 다시 등록하면 복원됩니다.`;
    $("project-remove-confirm").hidden = false;
    $("project-remove-cancel").focus();
  });
  $("project-remove-submit").addEventListener("click", () => {
    if ($("project-remove-submit").disabled || !removingId) return;
    const id = removingId;
    void action(async () => {
      await api(`/api/projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      close();
      await selectProject(null, true);
      showNotice(
        "프로젝트 등록을 해제했어요. 기존 파일과 배포 이력은 보관됩니다",
      );
    });
  });
}
