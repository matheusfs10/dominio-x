"use client";

import { fmtNumber } from "@/lib/format";

const STEPS: [string, string][] = [
  ["total", "Domínios no lote"],
  ["newDomains", "Domínios novos"],
  ["analyzed", "Analisados"],
  ["rejectedLocally", "Rejeitados localmente"],
  ["gatePassed", "Passaram no gate"],
  ["paidAnalyzed", "Análise paga (SEO)"],
  ["trafficLookedUp", "Consulta paga de tráfego"],
  ["highPotential", "Alto potencial (≥70)"],
  ["shortlisted", "Em shortlist"],
  ["failed", "Falharam"],
];

export function Funnel({ funnel }: { funnel: Record<string, number> }) {
  const max = Math.max(1, funnel.total ?? 0);
  return (
    <div className="space-y-1.5">
      {STEPS.map(([key, label]) => {
        const v = funnel[key] ?? 0;
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <div className="w-40 text-neutral-600">{label}</div>
            <div className="h-3 flex-1 overflow-hidden rounded bg-neutral-100">
              <div
                className={
                  key === "failed" || key === "rejectedLocally"
                    ? "h-full bg-rose-400"
                    : "h-full bg-sky-500"
                }
                style={{ width: `${Math.min(100, (v / max) * 100)}%` }}
              />
            </div>
            <div className="w-16 text-right tabular-nums">{fmtNumber(v)}</div>
          </div>
        );
      })}
    </div>
  );
}
