import { useEffect, useRef, useState } from "react";
import type { Console } from "../console";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldLabel } from "./ui/field";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";
import { StatusBadge } from "./StatusBadge";
import { X } from "lucide-react";

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
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) app.closeLogs();
      }}
    >
      <AlertDialogContent
        className="min-w-0 gap-0 overflow-hidden p-0 data-[size=default]:sm:max-w-5xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(`deployment-${state.deploymentId}`)?.focus();
        }}
      >
        <ScrollArea
          type="auto"
          className="min-w-0 [&>[data-slot=scroll-area-viewport]]:max-h-[90svh] [&>[data-slot=scroll-area-viewport]>div]:block!"
        >
          <div className="min-w-0 space-y-4 p-6">
            <AlertDialogHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pr-10 text-left">
              <div className="flex items-center gap-3">
                <AlertDialogTitle>실행 로그</AlertDialogTitle>
                {state.deployment && (
                  <StatusBadge status={state.deployment.status} />
                )}
              </div>
            </AlertDialogHeader>
            <AlertDialogDescription
              className={state.deployment ? "sr-only" : undefined}
            >
              {state.deployment
                ? "배포 실행 로그"
                : "존재하지 않거나 보관이 종료된 배포입니다."}
            </AlertDialogDescription>
            {state.deployment && (
              <div className="space-y-3">
                <ScrollArea
                  ref={terminal}
                  type="auto"
                  className="h-[min(60svh,32rem)] overflow-hidden rounded-md border bg-muted/40"
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
                <div className="flex justify-end text-xs text-muted-foreground">
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
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel variant="secondary">닫기</AlertDialogCancel>
            </AlertDialogFooter>
          </div>
        </ScrollArea>
        <AlertDialogCancel
          variant="secondary"
          size="icon"
          className="absolute top-2 right-2"
          aria-label="모달 닫기"
        >
          <X aria-hidden="true" />
        </AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>
  );
}
