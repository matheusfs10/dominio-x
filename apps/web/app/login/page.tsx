"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Button, ErrorBox, Input, Label } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { email, password });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-200 bg-white p-6"
    >
      <div>
        <h1 className="text-lg font-semibold">Dominio-X</h1>
        <p className="text-sm text-neutral-500">Internal access. Sign in to continue.</p>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <ErrorBox error={error} />
      <Button type="submit" variant="primary" disabled={busy} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
