"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPercent, label } from "@/lib/format";
import { Card, ErrorBox, Loading, PageHeader, Select, Stat } from "@/components/ui";

interface Usage {
  days: number;
  byProviderDay: {
    providerKey: string;
    day: string;
    requests: number;
    units: number;
    costUsd: number;
    errors: number;
    cached: number;
  }[];
  totals: {
    providerKey: string;
    requests: number;
    units: number;
    costUsd: number;
    errors: number;
    cached: number;
    lastSuccessAt: string | null;
    failureRate: number;
  }[];
  semrush: {
    unitsThisMonth: number;
    monthlyBudget: number | null;
    utilization: number | null;
    costThisMonthUsd: number;
  };
  dataforseo: {
    state: string;
    lookupsToday: number;
    lookupsThisMonth: number;
    costThisMonthUsd: number;
    monthlyCostBudgetUsd: number | null;
    utilization: number | null;
    windowMonths: number;
    locationName: string;
  };
  cache: { reusedObservations: number; providerCalls: number; hitRate: number | null };
  paidSkipped: {
    byCandidateGate: number;
    byBudget: number;
    decisionPending: number;
    notConfigured: number;
  };
  trafficSkipped: { blockedBy: string; count: number }[];
}

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["usage", days],
    queryFn: () => api.get<Usage>(`/usage?days=${days}`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const u = q.data!;
  const trafficBlocked = u.trafficSkipped.reduce((acc, r) => acc + r.count, 0);
  const topBlocker = u.trafficSkipped[0] ?? null;
  return (
    <div>
      <PageHeader
        title="Uso e custos"
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-32">
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {d} dias
              </option>
            ))}
          </Select>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Custo DataForSEO (mês)"
          value={`US$ ${fmtNumber(u.dataforseo.costThisMonthUsd, 2)}`}
          hint={
            u.dataforseo.monthlyCostBudgetUsd !== null
              ? `orçamento US$ ${fmtNumber(u.dataforseo.monthlyCostBudgetUsd, 2)} · ${fmtPercent(u.dataforseo.utilization)}`
              : "sem orçamento mensal definido"
          }
        />
        <Stat
          label="Consultas de tráfego"
          value={fmtNumber(u.dataforseo.lookupsThisMonth)}
          hint={`${fmtNumber(u.dataforseo.lookupsToday)} hoje · ${u.dataforseo.locationName}, ${u.dataforseo.windowMonths} meses`}
        />
        <Stat
          label="Barradas pelo gate de tráfego"
          value={fmtNumber(trafficBlocked)}
          hint={
            topBlocker
              ? `mais comum: ${label(topBlocker.blockedBy)} (${fmtNumber(topBlocker.count)})`
              : "nenhuma consulta barrada no período"
          }
        />
        <Stat label="Provedor de tráfego" value={label(u.dataforseo.state)} />
      </div>
      {u.dataforseo.monthlyCostBudgetUsd !== null && (
        <div className="mb-4 h-2 w-full overflow-hidden rounded bg-neutral-200">
          <div
            className={`h-full ${(u.dataforseo.utilization ?? 0) > 0.9 ? "bg-rose-500" : "bg-emerald-500"}`}
            style={{ width: `${Math.min(100, (u.dataforseo.utilization ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="Unidades Semrush (mês)"
          value={fmtNumber(u.semrush.unitsThisMonth)}
          hint={
            u.semrush.monthlyBudget
              ? `orçamento ${fmtNumber(u.semrush.monthlyBudget)} · ${fmtPercent(u.semrush.utilization)}`
              : "sem orçamento mensal definido"
          }
        />
        <Stat
          label="Custo Semrush (mês)"
          value={`US$ ${fmtNumber(u.semrush.costThisMonthUsd, 2)}`}
        />
        <Stat
          label="Reaproveitamento (cache)"
          value={fmtPercent(u.cache.hitRate)}
          hint={`${fmtNumber(u.cache.reusedObservations)} reutilizadas · ${fmtNumber(u.cache.providerCalls)} chamadas`}
        />
        <Stat
          label="Pagas barradas pelo gate"
          value={fmtNumber(u.paidSkipped.byCandidateGate)}
          hint={`${fmtNumber(u.paidSkipped.byBudget)} por orçamento`}
        />
        <Stat
          label="Semrush em standby"
          value={fmtNumber(u.paidSkipped.decisionPending)}
          hint="análises aguardando a decisão de integração"
        />
      </div>
      {u.semrush.monthlyBudget && (
        <div className="mb-4 h-2 w-full overflow-hidden rounded bg-neutral-200">
          <div
            className={`h-full ${(u.semrush.utilization ?? 0) > 0.9 ? "bg-rose-500" : "bg-sky-500"}`}
            style={{ width: `${Math.min(100, (u.semrush.utilization ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Totais (${u.days} dias)`}>
          <table>
            <thead>
              <tr>
                <th>Provedor</th>
                <th>Requisições</th>
                <th>Unidades</th>
                <th>Custo</th>
                <th>Erros</th>
                <th>Taxa de falha</th>
                <th>Em cache</th>
                <th>Último sucesso</th>
              </tr>
            </thead>
            <tbody>
              {u.totals.map((t) => (
                <tr key={t.providerKey}>
                  <td>{t.providerKey}</td>
                  <td>{fmtNumber(t.requests)}</td>
                  <td>{fmtNumber(t.units)}</td>
                  <td>US$ {fmtNumber(t.costUsd, 2)}</td>
                  <td>{fmtNumber(t.errors)}</td>
                  <td>{fmtPercent(t.failureRate)}</td>
                  <td>{fmtNumber(t.cached)}</td>
                  <td className="text-xs">{fmtDate(t.lastSuccessAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Onde o gate de tráfego barrou as consultas pagas">
          <p className="mb-3 text-xs text-neutral-500">
            Cada linha é uma consulta ao DataForSEO que <strong>não</strong> foi feita, e a
            checagem gratuita que a impediu. Se o funil estiver barrando demais, ajuste os limites
            em Configurações › Gate de tráfego.
          </p>
          {u.trafficSkipped.length === 0 ? (
            <p className="text-xs text-neutral-500">Nenhuma consulta barrada no período.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Checagem</th>
                  <th>Consultas barradas</th>
                </tr>
              </thead>
              <tbody>
                {u.trafficSkipped.map((r) => (
                  <tr key={r.blockedBy}>
                    <td>{label(r.blockedBy)}</td>
                    <td>{fmtNumber(r.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Requisições por provedor / dia">
          <div className="max-h-96 overflow-auto">
            <table>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Provedor</th>
                  <th>Requisições</th>
                  <th>Unidades</th>
                  <th>Erros</th>
                </tr>
              </thead>
              <tbody>
                {u.byProviderDay.map((r, i) => (
                  <tr key={i}>
                    <td className="text-xs">{r.day}</td>
                    <td>{r.providerKey}</td>
                    <td>{fmtNumber(r.requests)}</td>
                    <td>{fmtNumber(r.units)}</td>
                    <td>{fmtNumber(r.errors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
