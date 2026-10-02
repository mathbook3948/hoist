import { useConsole } from "./console";
import { Login } from "./components/Login";
import { Workspace } from "./components/Workspace";

export function App() {
  const app = useConsole();
  if (app.state.booting)
    return (
      <div className="boot-view" role="status">
        <span className="brand-mark" aria-hidden="true">
          ↗
        </span>
        <p>Hoist를 불러오는 중…</p>
      </div>
    );
  return app.state.user ? <Workspace app={app} /> : <Login app={app} />;
}
