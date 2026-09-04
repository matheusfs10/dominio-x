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
  trafficGate: TrafficGate;
  authorityGate: AuthorityGate;
  pipeline: Record<string, unknown>;
}
interface TrafficGate {
  enabled: boolean;
  maxDigits: number;
  maxHyphens: number;
  minSldLength: number;
  maxSldLength: number;
  maxRandomness: number;
  allowPunycode: boolean;
  requireDictionaryToken: boolean;
  allowedTlds: string[];
  requireDnsResolution: boolean;
  requireHttpReachable: boolean;
  allowedHttpStatuses: number[];
  requireCandidateGate: boolean;
  reuseWithinDays: number;
  maxLookupsPerBatch: number | null;
  maxLookupsPerDay: number | null;
  maxLookupsPerMonth: number | null;
  monthlyCostBudgetUsd: number | null;
  minAccountBalanceUsd: number;
}
interface AuthorityGate {
  enabled: boolean;
  allowedDispositions: string[];
  requireCandidateGate: boolean;
  minOverallScore: number | null;
  maxDigits: number;
  maxHyphens: number;
  minSldLength: number;
  maxSldLength: number;
  maxRandomness: number;
  allowPunycode: boolean;
  requireDictionaryToken: boolean;
  allowedTlds: string[];
  requireDnsResolution: boolean;
  requireHttpReachable: boolean;
  allowedHttpStatuses: number[];
  reuseWithinDays: number;
  maxLookupsPerBatch: number | null;
  maxLookupsPerDay: number | null;
  maxLookupsPerMonth: number | null;
  monthlyCostBudgetUsd: number | null;
  minSolverBalanceUsd: number;
}
interface AhrefsAccount {
  configured: boolean;
  state: string;
  solverState: string;
  costPerLookupUsd: number;
  balanceUsd: number | null;
  error?: string;
}
interface DataForSeoAccount {
  configured: boolean;
  state: string;
  balanceUsd: number | null;
  totalUsd: number | null;
  error?: string;
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
/** Automatic dispositions the rule engine can produce, in the order the UI shows them. */
const DISPOSITIONS = ["accepted", "needs_review", "quarantined", "rejected"] as const;
const DISPOSITION_LABELS: Record<string, string> = {
  accepted: "aceito",
  needs_review: "revisar",
  quarantined: "quarentena",
  rejected: "rejeitado",
};

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
const numOrNull = (value: string): number | null => (value === "" ? null : Number(value));

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
  const [traffic, setTraffic] = useState<TrafficGate | null>(null);
  const [authority, setAuthority] = useState<AuthorityGate | null>(null);
  useEffect(() => {
    if (settings.data) {
      setGate(settings.data.candidateGate);
      setTraffic(settings.data.trafficGate);
      setAuthority(settings.data.authorityGate);
    }
  }, [settings.data]);
  const saveGate = useMutation({
    mutationFn: () => api.patch("/settings", { candidateGate: gate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const saveTraffic = useMutation({
    mutationFn: () => api.patch("/settings", { trafficGate: traffic }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const saveAuthority = useMutation({
    mutationFn: () => api.patch("/settings", { authorityGate: authority }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  // The upstream balance endpoints are free, but they are still network calls: only on demand.
  const account = useQuery({
    queryKey: ["dataforseo-account"],
    queryFn: () => api.get<DataForSeoAccount>("/providers/dataforseo/account"),
    enabled: false,
  });
  const solverAccount = useQuery({
    queryKey: ["ahrefs-account"],
    queryFn: () => api.get<AhrefsAccount>("/providers/ahrefs/account"),
    enabled: false,
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

  if (settings.isLoading || !gate || !traffic || !authority) return <Loading />;
  return (
    <div>
      <PageHeader title="Configurações" />
      <ErrorBox
        error={
          saveGate.error ??
          saveTraffic.error ??
          saveAuthority.error ??
          addBl.error ??
          removeBl.error ??
          createUser.error ??
          updateUser.error
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
        <Card
          title="Gate de tráfego (consultas pagas ao DataForSEO)"
          actions={
            isAdmin && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void account.refetch()}>
                  Consultar saldo
                </Button>
                <Button variant="primary" size="sm" onClick={() => saveTraffic.mutate()}>
                  Salvar
                </Button>
              </div>
            )
          }
        >
          <p className="mb-3 text-xs text-neutral-500">
            Toda checagem aqui usa dados que já temos de graça (nome, DNS, crawler e o próprio
            histórico de consultas). Um domínio que reprova em qualquer checagem ativa{" "}
            <strong>nunca chega ao DataForSEO</strong> e portanto não custa nada. Analista pode
            forçar uma consulta em &ldquo;análise profunda&rdquo;: isso pula as checagens de
            qualificação, mas nunca os limites de volume e de custo.
          </p>
          {account.data && (
            <p className="mb-3 rounded bg-neutral-50 p-2 text-xs">
              Conta DataForSEO:{" "}
              {account.data.balanceUsd === null
                ? `sem saldo disponível (${label(account.data.state)}${account.data.error ? ` — ${account.data.error}` : ""})`
                : `saldo US$ ${account.data.balanceUsd.toFixed(2)} de US$ ${(account.data.totalUsd ?? 0).toFixed(2)} depositados`}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={traffic.enabled}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, enabled: e.target.checked })}
              />{" "}
              consulta automática ligada (desligada, só rodam consultas forçadas)
            </label>

            <h3 className="col-span-2 mt-1 text-xs font-semibold uppercase text-neutral-500">
              Formato do nome
            </h3>
            <div>
              <Label>Máx. de dígitos (0 = nenhum número)</Label>
              <Input
                type="number"
                min={0}
                value={traffic.maxDigits}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, maxDigits: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Máx. de hífens</Label>
              <Input
                type="number"
                min={0}
                value={traffic.maxHyphens}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, maxHyphens: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Tamanho mínimo do SLD</Label>
              <Input
                type="number"
                min={1}
                value={traffic.minSldLength}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, minSldLength: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Tamanho máximo do SLD</Label>
              <Input
                type="number"
                min={1}
                value={traffic.maxSldLength}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, maxSldLength: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Aleatoriedade máxima (0–1)</Label>
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={traffic.maxRandomness}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, maxRandomness: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>TLDs permitidos (vírgula; vazio = qualquer)</Label>
              <Input
                value={traffic.allowedTlds.join(", ")}
                disabled={!isAdmin}
                placeholder="com.br, br"
                onChange={(e) => setTraffic({ ...traffic, allowedTlds: splitList(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={traffic.allowPunycode}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, allowPunycode: e.target.checked })}
              />{" "}
              aceitar nomes IDN/punycode
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={traffic.requireDictionaryToken}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTraffic({ ...traffic, requireDictionaryToken: e.target.checked })
                }
              />{" "}
              exigir palavra de dicionário
            </label>

            <h3 className="col-span-2 mt-1 text-xs font-semibold uppercase text-neutral-500">
              Evidência de rede
            </h3>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={traffic.requireDnsResolution}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, requireDnsResolution: e.target.checked })}
              />{" "}
              exigir resolução de DNS
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={traffic.requireHttpReachable}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, requireHttpReachable: e.target.checked })}
              />{" "}
              exigir site respondendo
            </label>
            <div>
              <Label>Status HTTP aceitos (vírgula; vazio = qualquer)</Label>
              <Input
                value={traffic.allowedHttpStatuses.join(", ")}
                disabled={!isAdmin}
                placeholder="200, 301"
                onChange={(e) =>
                  setTraffic({
                    ...traffic,
                    allowedHttpStatuses: splitList(e.target.value)
                      .map(Number)
                      .filter((n) => Number.isFinite(n)),
                  })
                }
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={traffic.requireCandidateGate}
                disabled={!isAdmin}
                onChange={(e) => setTraffic({ ...traffic, requireCandidateGate: e.target.checked })}
              />{" "}
              exigir aprovação no gate de candidatos
            </label>

            <h3 className="col-span-2 mt-1 text-xs font-semibold uppercase text-neutral-500">
              Limites de volume e de custo
            </h3>
            <div>
              <Label>Carência entre consultas do mesmo domínio (dias)</Label>
              <Input
                type="number"
                min={0}
                value={traffic.reuseWithinDays}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTraffic({ ...traffic, reuseWithinDays: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Máx. de consultas por lote (vazio = ilimitado)</Label>
              <Input
                type="number"
                min={0}
                value={traffic.maxLookupsPerBatch ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTraffic({ ...traffic, maxLookupsPerBatch: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Máx. de consultas por dia (vazio = ilimitado)</Label>
              <Input
                type="number"
                min={0}
                value={traffic.maxLookupsPerDay ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTraffic({ ...traffic, maxLookupsPerDay: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Máx. de consultas por mês (vazio = ilimitado)</Label>
              <Input
                type="number"
                min={0}
                value={traffic.maxLookupsPerMonth ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTraffic({ ...traffic, maxLookupsPerMonth: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Orçamento mensal em US$ (vazio = só o do ambiente)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={traffic.monthlyCostBudgetUsd ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTraffic({ ...traffic, monthlyCostBudgetUsd: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Saldo mínimo da conta em US$ (0 = não checar)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={traffic.minAccountBalanceUsd}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTraffic({ ...traffic, minAccountBalanceUsd: Number(e.target.value) })
                }
              />
            </div>
          </div>
        </Card>
        <Card
          title="Gate de autoridade (Domain Rating do Ahrefs)"
          actions={
            isAdmin && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void solverAccount.refetch()}>
                  Consultar saldo
                </Button>
                <Button variant="primary" size="sm" onClick={() => saveAuthority.mutate()}>
                  Salvar
                </Button>
              </div>
            )
          }
        >
          <p className="mb-3 text-xs text-neutral-500">
            A consulta de Domain Rating roda <strong>depois do motor de regras</strong>, então o
            filtro mais forte e mais barato é a própria disposição automática: um domínio que as
            regras rejeitaram nunca chega ao Ahrefs. Cada consulta custa exatamente um captcha
            resolvido, e esse custo é cobrado mesmo quando o índice não conhece o domínio. Analista
            pode forçar uma consulta em &ldquo;análise profunda&rdquo;: isso pula as checagens de
            qualificação, mas nunca os limites de volume e de custo.
          </p>
          {solverAccount.data && (
            <p className="mb-3 rounded bg-neutral-50 p-2 text-xs">
              Resolvedor de captcha ({label(solverAccount.data.solverState)}):{" "}
              {solverAccount.data.balanceUsd === null
                ? `sem saldo disponível${solverAccount.data.error ? ` — ${solverAccount.data.error}` : ""}`
                : `US$ ${solverAccount.data.balanceUsd.toFixed(2)} de crédito, ` +
                  `US$ ${solverAccount.data.costPerLookupUsd} por consulta ` +
                  `(~${Math.floor(solverAccount.data.balanceUsd / Math.max(solverAccount.data.costPerLookupUsd, 1e-9)).toLocaleString("pt-BR")} consultas)`}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={authority.enabled}
                  disabled={!isAdmin}
                  onChange={(e) => setAuthority({ ...authority, enabled: e.target.checked })}
                />
                consultar automaticamente no pipeline
              </label>
            </div>
            <div className="col-span-2">
              <Label>Disposições aceitas (vazio = qualquer uma)</Label>
              <div className="flex flex-wrap gap-3 text-xs">
                {DISPOSITIONS.map((d) => (
                  <label key={d} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={authority.allowedDispositions.includes(d)}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        setAuthority({
                          ...authority,
                          allowedDispositions: e.target.checked
                            ? [...authority.allowedDispositions, d]
                            : authority.allowedDispositions.filter((x) => x !== d),
                        })
                      }
                    />
                    {DISPOSITION_LABELS[d]}
                  </label>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={authority.requireCandidateGate}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    setAuthority({ ...authority, requireCandidateGate: e.target.checked })
                  }
                />
                exigir aprovação no gate de candidatos
              </label>
            </div>
            <div className="col-span-2">
              <Label>Nota geral mínima da última análise concluída (vazio = não checar)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={authority.minOverallScore ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, minOverallScore: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Máx. de dígitos</Label>
              <Input
                type="number"
                min={0}
                value={authority.maxDigits}
                disabled={!isAdmin}
                onChange={(e) => setAuthority({ ...authority, maxDigits: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Máx. de hífens</Label>
              <Input
                type="number"
                min={0}
                value={authority.maxHyphens}
                disabled={!isAdmin}
                onChange={(e) => setAuthority({ ...authority, maxHyphens: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Tamanho mínimo do SLD</Label>
              <Input
                type="number"
                min={1}
                value={authority.minSldLength}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, minSldLength: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Tamanho máximo do SLD</Label>
              <Input
                type="number"
                min={1}
                value={authority.maxSldLength}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, maxSldLength: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Aleatoriedade máxima (0 a 1)</Label>
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={authority.maxRandomness}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, maxRandomness: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>TLDs permitidos (vazio = qualquer)</Label>
              <Input
                value={authority.allowedTlds.join(", ")}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, allowedTlds: splitList(e.target.value) })
                }
              />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={authority.allowPunycode}
                  disabled={!isAdmin}
                  onChange={(e) => setAuthority({ ...authority, allowPunycode: e.target.checked })}
                />
                permitir nomes IDN (punycode)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={authority.requireDictionaryToken}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    setAuthority({ ...authority, requireDictionaryToken: e.target.checked })
                  }
                />
                exigir palavra de dicionário no nome
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={authority.requireDnsResolution}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    setAuthority({ ...authority, requireDnsResolution: e.target.checked })
                  }
                />
                exigir que o domínio resolva em DNS
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={authority.requireHttpReachable}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    setAuthority({ ...authority, requireHttpReachable: e.target.checked })
                  }
                />
                exigir que o site responda por HTTP
              </label>
            </div>
            <div className="col-span-2">
              <Label>Status HTTP aceitos (vazio = qualquer)</Label>
              <Input
                value={authority.allowedHttpStatuses.join(", ")}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({
                    ...authority,
                    allowedHttpStatuses: splitList(e.target.value).map(Number),
                  })
                }
              />
            </div>
            <div>
              <Label>Não repetir por (dias)</Label>
              <Input
                type="number"
                min={0}
                value={authority.reuseWithinDays}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, reuseWithinDays: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Máx. por lote (vazio = sem limite)</Label>
              <Input
                type="number"
                min={0}
                value={authority.maxLookupsPerBatch ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, maxLookupsPerBatch: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Máx. por dia (vazio = sem limite)</Label>
              <Input
                type="number"
                min={0}
                value={authority.maxLookupsPerDay ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, maxLookupsPerDay: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Máx. por mês (vazio = sem limite)</Label>
              <Input
                type="number"
                min={0}
                value={authority.maxLookupsPerMonth ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, maxLookupsPerMonth: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Orçamento mensal em US$ (vazio = só o do ambiente)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={authority.monthlyCostBudgetUsd ?? ""}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, monthlyCostBudgetUsd: numOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Saldo mínimo do resolvedor em US$ (0 = não checar)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={authority.minSolverBalanceUsd}
                disabled={!isAdmin}
                onChange={(e) =>
                  setAuthority({ ...authority, minSolverBalanceUsd: Number(e.target.value) })
                }
              />
            </div>
          </div>
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
