import { useState, type FormEvent } from "react";
import type { Console } from "../console";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "./ui/field";
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
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="username">사용자 이름</FieldLabel>
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
              </Field>
              <Field>
                <FieldLabel htmlFor="password">비밀번호</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </FieldGroup>
            {app.state.loginError && (
              <FieldError className="text-xs">
                {app.state.loginError}
              </FieldError>
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
