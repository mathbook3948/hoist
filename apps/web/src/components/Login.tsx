import { useState, type FormEvent } from "react";
import type { Console } from "../console";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

export function Login({ app }: { app: Console }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await app.login(username, password);
    } finally {
      setPassword("");
    }
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>로그인</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form id="login-form" className="space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="username">사용자 이름</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                required
                maxLength={64}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {app.state.loginError && (
              <p role="alert" className="text-xs text-destructive">
                {app.state.loginError}
              </p>
            )}
            <Button
              id="login-button"
              className="w-full"
              type="submit"
              disabled={Boolean(app.state.busy)}
            >
              {app.state.busy === "login" ? "로그인 중…" : "로그인"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
