import { useEffect, useRef, useState } from "react";
import type { Console } from "../console";
import { formatDate, isActive } from "../display";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldLabel } from "./ui/field";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";
import { StatusBadge } from "./StatusBadge";

export function Logs({ app }: { app: Console }) {
  const { state } = app;
  const [follow, setFollow] = useState(true);
  const terminal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = terminal.current?.querySelector<HTMLDivElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (follow && viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [state.log, follow]);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CardTitle>실행 로그</CardTitle>
          {state.deployment && <StatusBadge status={state.deployment.status} />}
        </div>
        {isActive(state.deployment) && (
          <Button
            id="cancel-button"
            variant="destructive"
            disabled={Boolean(state.busy || state.loadingLog)}
            onClick={() => void app.cancel()}
          >
            실행 취소
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{state.deployment?.version || "선택된 배포 없음"}</span>
          {isActive(state.deployment) && state.visible && <span>실시간</span>}
        </div>
        <ScrollArea
          ref={terminal}
          type="auto"
          className="h-72 overflow-hidden rounded-md border bg-muted/40"
        >
          <pre
            id="log-output"
            className="w-max min-w-full p-4 font-mono text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
            tabIndex={0}
            aria-label="배포 실행 로그"
          >
            {state.log}
          </pre>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            {state.loadingLog && <Spinner />}
            {state.loadingLog
              ? "실행 로그를 불러오는 중…"
              : state.deployment
                ? `${state.deployment.finishedAt ? "종료 " + formatDate(state.deployment.finishedAt) : "시작 " + formatDate(state.deployment.startedAt)}${state.deployment.exitCode != null ? ` · 종료 코드 ${state.deployment.exitCode}` : ""}`
                : "배포를 선택하면 로그가 표시됩니다"}
          </span>
          <Field orientation="horizontal" className="w-auto gap-2">
            <Checkbox
              id="follow-log"
              checked={follow}
              onCheckedChange={(value) => setFollow(value === true)}
            />
            <FieldLabel htmlFor="follow-log" className="text-xs">
              로그 따라가기
            </FieldLabel>
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
