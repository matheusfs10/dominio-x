"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useRole } from "@/components/shell";
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Input,
  Label,
  Loading,
  PageHeader,
  Select,
} from "@/components/ui";

interface Settings {
  candidateGate: {
    enabled: boolean;
    maxSldLength: number;
    maxDigits: number;
    maxHyphens: number;
    maxRandomness: number;
    requireEvidence: boolean;
    maxDeepAnalysesPerBatch: number | null;
  };
  pipeline: Record<string, unknown>;
}
interface Blacklist {
  id: string;
  pattern: string;
  reason: string;
  createdAt: string;
}
interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { isAdmin, isAnalyst } = useRole();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
  });
  const blacklist = useQuery({
    queryKey: ["blacklist"],
    queryFn: () => api.get<{ items: Blacklist[] }>("/blacklist"),
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ items: User[] }>("/users"),
    enabled: isAdmin,
  });
  const [gate, setGate] = useState<Settings["candidateGate"] | null>(null);
  useEffect(() => {
    if (settings.data) setGate(settings.data.candidateGate);
  }, [settings.data]);
  const saveGate = useMutation({
    mutationFn: () => api.patch("/settings", { candidateGate: gate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const addBl = useMutation({
    mutationFn: (input: { pattern: string; reason: string }) => api.post("/blacklist", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blacklist"] }),
  });
  const removeBl = useMutation({
    mutationFn: (id: string) => api.delete(`/blacklist/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blacklist"] }),
  });
  const createUser = useMutation({
    mutationFn: (input: { email: string; name: string; password: string; role: string }) =>
      api.post("/users", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  const updateUser = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; role?: string; active?: boolean }) =>
      api.patch(`/users/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  function submitBl(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addBl.mutate({ pattern: f.get("pattern") as string, reason: f.get("reason") as string });
    e.currentTarget.reset();
  }
  function submitUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    createUser.mutate({
      email: f.get("email") as string,
      name: f.get("name") as string,
      password: f.get("password") as string,
      role: f.get("role") as string,
    });
    e.currentTarget.reset();
  }

  if (settings.isLoading || !gate) return <Loading />;
  return (
    <div>
      <PageHeader title="Settings" />
      <ErrorBox
        error={
          saveGate.error ?? addBl.error ?? removeBl.error ?? createUser.error ?? updateUser.error
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Candidate gate (paid-provider funnel)"
          actions={
            isAdmin && (
              <Button variant="primary" size="sm" onClick={() => saveGate.mutate()}>
                Save
              </Button>
            )
          }
        >
          <p className="mb-3 text-xs text-neutral-500">
            Paid enrichment runs only for domains that pass this gate (or are forced by an analyst).
            Rule actions candidate_allow / candidate_deny take precedence over thresholds.
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={gate.enabled}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, enabled: e.target.checked })}
              />{" "}
              gate enabled (when disabled every domain is a paid candidate)
            </label>
            <div>
              <Label>Max SLD length</Label>
              <Input
                type="number"
                value={gate.maxSldLength}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, maxSldLength: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Max digits</Label>
              <Input
                type="number"
                value={gate.maxDigits}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, maxDigits: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Max hyphens</Label>
              <Input
                type="number"
                value={gate.maxHyphens}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, maxHyphens: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Max randomness (0–1)</Label>
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={gate.maxRandomness}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, maxRandomness: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Max deep analyses per batch (blank = unlimited)</Label>
              <Input
                type="number"
                value={gate.maxDeepAnalysesPerBatch ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setGate({
                    ...gate,
                    maxDeepAnalysesPerBatch: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={gate.requireEvidence}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, requireEvidence: e.target.checked })}
              />{" "}
              require DNS/HTTP evidence
            </label>
          </div>
          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-neutral-500">
            Pipeline (environment)
          </h3>
          <pre className="rounded bg-neutral-50 p-2 text-xs">
            {JSON.stringify(settings.data!.pipeline, null, 2)}
          </pre>
        </Card>
        <Card title="Blacklist (preflight hard reject)">
          {isAnalyst && (
            <form onSubmit={submitBl} className="mb-3 flex gap-2">
              <Input
                name="pattern"
                placeholder="exact.com.br | .suffix.br | *substring*"
                required
              />
              <Input name="reason" placeholder="reason" required />
              <Button type="submit" size="sm">
                Add
              </Button>
            </form>
          )}
          {blacklist.isLoading ? (
            <Loading />
          ) : !blacklist.data?.items.length ? (
            <Empty label="Blacklist is empty." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th>Reason</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {blacklist.data.items.map((b) => (
                  <tr key={b.id}>
                    <td className="font-mono text-xs">{b.pattern}</td>
                    <td className="text-xs">{b.reason}</td>
                    <td className="text-xs">{fmtDate(b.createdAt)}</td>
                    <td>
                      {isAnalyst && (
                        <Button size="sm" variant="ghost" onClick={() => removeBl.mutate(b.id)}>
                          remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {isAdmin && (
          <Card title="Users" className="lg:col-span-2">
            <form onSubmit={submitUser} className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              <Input name="email" type="email" placeholder="email" required autoComplete="off" />
              <Input name="name" placeholder="name" required />
              <Input
                name="password"
                type="password"
                placeholder="password (12+ chars)"
                required
                autoComplete="new-password"
              />
              <Select name="role" defaultValue="analyst">
                <option value="viewer">viewer</option>
                <option value="analyst">analyst</option>
                <option value="admin">admin</option>
              </Select>
              <Button type="submit" variant="primary">
                Create user
              </Button>
            </form>
            {users.isLoading ? (
              <Loading />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Active</th>
                    <th>Last login</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data?.items.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.name}</td>
                      <td>
                        <Select
                          value={u.role}
                          onChange={(e) => updateUser.mutate({ id: u.id, role: e.target.value })}
                          className="w-28"
                        >
                          <option value="viewer">viewer</option>
                          <option value="analyst">analyst</option>
                          <option value="admin">admin</option>
                        </Select>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          onClick={() => updateUser.mutate({ id: u.id, active: !u.active })}
                        >
                          {u.active ? "active" : "inactive"}
                        </Button>
                      </td>
                      <td className="text-xs">{fmtDate(u.lastLoginAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
