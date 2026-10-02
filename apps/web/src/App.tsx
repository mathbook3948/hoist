import { useConsole } from "./console";
import { Login } from "./components/Login";
import { Workspace } from "./components/Workspace";
import { Skeleton } from "./components/ui/skeleton";
export function App() {
  const app = useConsole();
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
  return app.state.user ? <Workspace app={app} /> : <Login app={app} />;
}
