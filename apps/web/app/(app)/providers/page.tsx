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
        title="Providers"
        subtitle="Adapters are configured through environment variables; keys are never shown here. Operational limits live in the registry."
      />
      <ErrorBox error={toggle.error ?? setBudget.error} />
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Runtime</th>
                <th>Enabled</th>
                <th>Paid</th>
                <th>Capabilities</th>
                <th>Rate / conc.</th>
                <th>Timeout</th>
                <th>TTL</th>
                <th>Retention</th>
                <th>24h req / fail</th>
                <th>Last success</th>
                <th>30d units / cost</th>
                <th>Budget</th>
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
                        {p.enabled ? "on" : "off"}
                      </Button>
                    ) : p.enabled ? (
                      "on"
                    ) : (
                      "off"
                    )}
                  </td>
                  <td>{p.paid ? "yes" : "no"}</td>
                  <td className="text-xs">{p.capabilities.join(", ")}</td>
                  <td className="text-xs">
                    {p.rateLimitRps} rps / {p.concurrencyLimit}
                  </td>
                  <td className="text-xs">{p.timeoutMs} ms</td>
                  <td className="text-xs">
                    {p.defaultTtlHours ? `${p.defaultTtlHours} h` : "none"}
                  </td>
                  <td className="text-xs">{p.retentionPolicy}</td>
                  <td className="text-xs">
                    {fmtNumber(p.stats.requests24h)} / {fmtPercent(p.stats.failureRate24h)}
                  </td>
                  <td className="text-xs">{fmtDate(p.stats.lastSuccessAt)}</td>
                  <td className="text-xs">
                    {fmtNumber(p.stats.units30d)} / ${fmtNumber(p.stats.costUsd30d, 2)}
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
                            placeholder="units/mo"
                          />
                          <Button size="sm" type="submit">
                            set
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
