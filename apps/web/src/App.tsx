import { useConsole } from "./console";
import { Login } from "./components/Login";
import { Workspace } from "./components/Workspace";
import { Skeleton } from "./components/ui/skeleton";
import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
export function App() {
  const app = useConsole();
  useEffect(() => {
    if (!app.state.user) {
      toast.dismiss();
      return;
    }
    if (app.state.notice) {
      const notify = app.state.noticeError ? toast.error : toast.success;
      notify(app.state.notice, { id: "console-notice" });
    }
  }, [app.state.notice, app.state.noticeError, app.state.user]);
  if (app.state.booting)
    return (
      <main
        className="mx-auto max-w-5xl space-y-4 p-8"
        role="status"
        aria-label="불러오는 중"
      >
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  return (
    <TooltipProvider>
      {app.state.user ? <Workspace app={app} /> : <Login app={app} />}
      <Toaster theme="light" position="bottom-right" closeButton />
    </TooltipProvider>
  );
}
