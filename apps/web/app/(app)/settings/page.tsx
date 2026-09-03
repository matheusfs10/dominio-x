"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { fmtDate, label } from "@/lib/format";
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

const ROLES = ["viewer", "analyst", "admin"] as const;

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
      <PageHeader title="Configurações" />
      <ErrorBox
        error={
          saveGate.error ?? addBl.error ?? removeBl.error ?? createUser.error ?? updateUser.error
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Gate de candidatos (funil dos provedores pagos)"
          actions={
            isAdmin && (
              <Button variant="primary" size="sm" onClick={() => saveGate.mutate()}>
                Salvar
              </Button>
            )
          }
        >
          <p className="mb-3 text-xs text-neutral-500">
            O enriquecimento pago só roda para domínios que passam neste gate (ou forçados por um
            analista). As ações de regra candidate_allow / candidate_deny têm precedência sobre os
            limites abaixo.
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={gate.enabled}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, enabled: e.target.checked })}
              />{" "}
              gate ativo (desligado, todo domínio vira candidato pago)
            </label>
            <div>
              <Label>Tamanho máximo do SLD</Label>
              <Input
                type="number"
                value={gate.maxSldLength}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, maxSldLength: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Máx. de dígitos</Label>
              <Input
                type="number"
                value={gate.maxDigits}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, maxDigits: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Máx. de hífens</Label>
              <Input
                type="number"
                value={gate.maxHyphens}
                disabled={!isAdmin}
                onChange={(e) => setGate({ ...gate, maxHyphens: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Aleatoriedade máxima (0–1)</Label>
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
              <Label>Máx. de análises profundas por lote (vazio = ilimitado)</Label>
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
              exigir evidência de DNS/HTTP
            </label>
          </div>
          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-neutral-500">
            Pipeline (ambiente)
          </h3>
          <pre className="rounded bg-neutral-50 p-2 text-xs">
            {JSON.stringify(settings.data!.pipeline, null, 2)}
          </pre>
        </Card>
        <Card title="Lista de bloqueio (rejeição na pré-checagem)">
          {isAnalyst && (
            <form onSubmit={submitBl} className="mb-3 flex gap-2">
              <Input name="pattern" placeholder="exato.com.br | .sufixo.br | *trecho*" required />
              <Input name="reason" placeholder="motivo" required />
              <Button type="submit" size="sm">
                Adicionar
              </Button>
            </form>
          )}
          {blacklist.isLoading ? (
            <Loading />
          ) : !blacklist.data?.items.length ? (
            <Empty label="A lista de bloqueio está vazia." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Padrão</th>
                  <th>Motivo</th>
                  <th>Adicionado em</th>
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
                          remover
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
          <Card title="Usuários" className="lg:col-span-2">
            <form onSubmit={submitUser} className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              <Input name="email" type="email" placeholder="e-mail" required autoComplete="off" />
              <Input name="name" placeholder="nome" required />
              <Input
                name="password"
                type="password"
                placeholder="senha (12+ caracteres)"
                required
                autoComplete="new-password"
              />
              <Select name="role" defaultValue="analyst">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="primary">
                Criar usuário
              </Button>
            </form>
            {users.isLoading ? (
              <Loading />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>E-mail</th>
                    <th>Nome</th>
                    <th>Papel</th>
                    <th>Ativo</th>
                    <th>Último acesso</th>
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
                          className="w-32"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {label(r)}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          onClick={() => updateUser.mutate({ id: u.id, active: !u.active })}
                        >
                          {u.active ? "ativo" : "inativo"}
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
