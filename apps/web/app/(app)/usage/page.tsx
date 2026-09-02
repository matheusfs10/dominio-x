"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
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
  cache: { reusedObservations: number; providerCalls: number; hitRate: number | null };
  paidSkipped: {
    byCandidateGate: number;
    byBudget: number;
    decisionPending: number;
    notConfigured: number;
  };
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
  return (
    <div>
      <PageHeader
        title="Usage & Costs"
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-32">
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </Select>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="Semrush units (month)"
          value={fmtNumber(u.semrush.unitsThisMonth)}
          hint={
            u.semrush.monthlyBudget
              ? `budget ${fmtNumber(u.semrush.monthlyBudget)} · ${fmtPercent(u.semrush.utilization)}`
              : "no monthly budget set"
          }
        />
        <Stat label="Semrush cost (month)" value={`$${fmtNumber(u.semrush.costThisMonthUsd, 2)}`} />
        <Stat
          label="Cache hit rate"
          value={fmtPercent(u.cache.hitRate)}
          hint={`${fmtNumber(u.cache.reusedObservations)} reused · ${fmtNumber(u.cache.providerCalls)} calls`}
        />
        <Stat
          label="Paid skipped by gate"
          value={fmtNumber(u.paidSkipped.byCandidateGate)}
          hint={`${fmtNumber(u.paidSkipped.byBudget)} by budget`}
        />
        <Stat
          label="Semrush standby"
          value={fmtNumber(u.paidSkipped.decisionPending)}
          hint="analyses awaiting integration decision"
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
        <Card title={`Totals (${u.days} days)`}>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Requests</th>
                <th>Units</th>
                <th>Cost</th>
                <th>Errors</th>
                <th>Failure</th>
                <th>Cached</th>
                <th>Last success</th>
              </tr>
            </thead>
            <tbody>
              {u.totals.map((t) => (
                <tr key={t.providerKey}>
                  <td>{t.providerKey}</td>
                  <td>{fmtNumber(t.requests)}</td>
                  <td>{fmtNumber(t.units)}</td>
                  <td>${fmtNumber(t.costUsd, 2)}</td>
                  <td>{fmtNumber(t.errors)}</td>
                  <td>{fmtPercent(t.failureRate)}</td>
                  <td>{fmtNumber(t.cached)}</td>
                  <td className="text-xs">{fmtDate(t.lastSuccessAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Requests by provider / day">
          <div className="max-h-96 overflow-auto">
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Provider</th>
                  <th>Requests</th>
                  <th>Units</th>
                  <th>Errors</th>
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
