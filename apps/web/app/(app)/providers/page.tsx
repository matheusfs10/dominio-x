"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { useRole } from "@/components/shell";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader } from "@/components/ui";

interface Provider {
  key: string;
  name: string;
  enabled: boolean;
  paid: boolean;
  capabilities: string[];
  rateLimitRps: number;
  concurrencyLimit: number;
  timeoutMs: number;
  defaultTtlHours: number;
  retentionPolicy: string;
  monthlyUnitBudget: number | null;
  configJson: Record<string, unknown>;
  runtime: { configured: boolean; state: string; detail?: string };
  stats: {
    requests24h: number;
    errors24h: number;
    failureRate24h: number;
    lastSuccessAt: string | null;
    units30d: number;
    costUsd30d: number;
  };
}

const RETENTION_LABELS: Record<string, string> = {
  internal: "interno",
  public_source: "fonte pública",
  provider_restricted: "restrito ao provedor",
  provider_contractual: "contratual",
};

export default function ProvidersPage() {
  const qc = useQueryClient();
  const { isAdmin } = useRole();
  const q = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.get<{ items: Provider[] }>("/providers"),
    refetchInterval: 15_000,
  });
  const toggle = useMutation({
    mutationFn: (p: Provider) => api.patch(`/providers/${p.key}`, { enabled: !p.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers"] }),
  });
  const setBudget = useMutation({
    mutationFn: ({ key, budget }: { key: string; budget: number | null }) =>
      api.patch(`/providers/${key}`, { monthlyUnitBudget: budget }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers"] }),
  });
  return (
    <div>
      <PageHeader
        title="Provedores"
        subtitle="Os adaptadores são configurados por variáveis de ambiente; chaves nunca aparecem aqui. Os limites operacionais ficam no registro."
      />
      <ErrorBox error={toggle.error ?? setBudget.error} />
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Provedor</th>
                <th>Estado</th>
                <th>Ativo</th>
                <th>Pago</th>
                <th>Capacidades</th>
                <th>Taxa / conc.</th>
                <th>Timeout</th>
                <th>TTL</th>
                <th>Retenção</th>
                <th>24 h req. / falhas</th>
                <th>Último sucesso</th>
                <th>30 d unidades / custo</th>
                <th>Orçamento</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.items.map((p) => (
                <tr key={p.key}>
                  <td>
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-xs text-neutral-500">{p.key}</div>
                  </td>
                  <td>
                    <Badge value={p.runtime.state} />
                    <div className="max-w-56 text-[11px] text-neutral-500">{p.runtime.detail}</div>
                  </td>
                  <td>
                    {isAdmin ? (
                      <Button size="sm" onClick={() => toggle.mutate(p)}>
                        {p.enabled ? "ligado" : "desligado"}
                      </Button>
                    ) : p.enabled ? (
                      "ligado"
                    ) : (
                      "desligado"
                    )}
                  </td>
                  <td>{p.paid ? "sim" : "não"}</td>
                  <td className="text-xs">{p.capabilities.join(", ")}</td>
                  <td className="text-xs">
                    {p.rateLimitRps} req/s / {p.concurrencyLimit}
                  </td>
                  <td className="text-xs">{p.timeoutMs} ms</td>
                  <td className="text-xs">
                    {p.defaultTtlHours ? `${p.defaultTtlHours} h` : "sem expiração"}
                  </td>
                  <td className="text-xs">
                    {RETENTION_LABELS[p.retentionPolicy] ?? p.retentionPolicy}
                  </td>
                  <td className="text-xs">
                    {fmtNumber(p.stats.requests24h)} / {fmtPercent(p.stats.failureRate24h)}
                  </td>
                  <td className="text-xs">{fmtDate(p.stats.lastSuccessAt)}</td>
                  <td className="text-xs">
                    {fmtNumber(p.stats.units30d)} / US$ {fmtNumber(p.stats.costUsd30d, 2)}
                  </td>
                  <td className="text-xs">
                    {p.paid ? (
                      isAdmin ? (
                        <form
                          className="flex gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const v = (
                              new FormData(e.currentTarget).get("budget") as string
                            ).trim();
                            setBudget.mutate({ key: p.key, budget: v ? Number(v) : null });
                          }}
                        >
                          <input
                            name="budget"
                            defaultValue={p.monthlyUnitBudget ?? ""}
                            className="w-20 rounded border border-neutral-300 px-1 text-xs"
                            placeholder="unid./mês"
                          />
                          <Button size="sm" type="submit">
                            definir
                          </Button>
                        </form>
                      ) : (
                        fmtNumber(p.monthlyUnitBudget)
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
