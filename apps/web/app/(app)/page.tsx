"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPercent, fmtScore } from "@/lib/format";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, ScoreBar, Stat } from "@/components/ui";
import { Funnel } from "@/components/funnel";

interface Dashboard {
  domains: {
    known: number;
    analyzed: number;
    highScore: number;
    shortlisted: number;
    newLast24h: number;
  };
  runs: { all: Record<string, number>; last24h: Record<string, number> };
  queue: {
    depth: number;
    active: number;
    stages: { stage: string; waiting: number; active: number; delayed: number; failed: number }[];
    crawler: Record<string, number>;
  };
  latestBatch: {
    batch: {
      id: string;
      name: string | null;
      detectedAt: string;
      domainCount: number;
      contentSha256: string;
      status: string;
    };
    funnel: Record<string, number>;
  } | null;
  topCandidates: {
    id: string;
    asciiFqdn: string;
    overallScore: number | null;
    confidenceScore: number | null;
    disposition: string | null;
    riskScore: number | null;
  }[];
  usage: {
    totals: { providerKey: string; requests: number; units: number; errors: number }[];
    semrush: {
      unitsThisMonth: number;
      monthlyBudget: number | null;
      utilization: number | null;
      costThisMonthUsd: number;
    };
    cache: { hitRate: number | null };
    paidSkipped: { byCandidateGate: number; decisionPending: number };
  };
  recentErrors: {
    id: string;
    component: string;
    code: string;
    message: string;
    createdAt: string;
  }[];
}

export default function OverviewPage() {
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dashboard>("/dashboard"),
    refetchInterval: 15_000,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const r24 = d.runs.last24h;
  return (
    <div>
      <PageHeader
        title="Visão geral"
        subtitle="Panorama operacional de ingestão, análises e uso dos provedores."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="Domínios conhecidos"
          value={fmtNumber(d.domains.known)}
          hint={`${fmtNumber(d.domains.newLast24h)} novos em 24 h`}
        />
        <Stat
          label="Domínios analisados"
          value={fmtNumber(d.domains.analyzed)}
          hint={`${fmtNumber(d.domains.highScore)} com nota ≥ 70`}
        />
        <Stat
          label="Fila"
          value={fmtNumber(d.queue.depth)}
          hint={`${d.queue.active} em execução · crawler pendente ${d.queue.crawler.pending ?? 0}`}
        />
        <Stat
          label="Análises (24 h)"
          value={`${fmtNumber(r24.completed)} ✓`}
          hint={`${r24.partial ?? 0} parciais · ${r24.failed ?? 0} falhas · ${(r24.queued ?? 0) + (r24.running ?? 0)} abertas`}
        />
        <Stat
          label="Unidades Semrush"
          value={fmtNumber(d.usage.semrush.unitsThisMonth)}
          hint={
            d.usage.semrush.monthlyBudget
              ? `${fmtPercent(d.usage.semrush.utilization)} de ${fmtNumber(d.usage.semrush.monthlyBudget)}`
              : "sem orçamento configurado"
          }
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Último lote do Registro.br"
          actions={
            d.latestBatch && (
              <Link
                className="text-xs text-sky-700 hover:underline"
                href={`/batches/${d.latestBatch.batch.id}`}
              >
                Abrir
              </Link>
            )
          }
        >
          {d.latestBatch ? (
            <div>
              <div className="mb-3 text-sm text-neutral-600">
                Detectado em {fmtDate(d.latestBatch.batch.detectedAt)} ·{" "}
                {fmtNumber(d.latestBatch.batch.domainCount)} domínios ·{" "}
                <Badge value={d.latestBatch.batch.status} />
              </div>
              <Funnel funnel={d.latestBatch.funnel} />
            </div>
          ) : (
            <Empty label="Nenhum lote do Registro.br ingerido ainda. O agendador roda a cada 6 horas." />
          )}
        </Card>
        <Card title="Candidatos com maior nota">
          {d.topCandidates.length === 0 ? (
            <Empty label="Nenhum domínio pontuado ainda." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Domínio</th>
                  <th>Geral</th>
                  <th>Confiança</th>
                  <th>Risco</th>
                  <th>Disposição</th>
                </tr>
              </thead>
              <tbody>
                {d.topCandidates.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link
                        className="font-medium text-sky-700 hover:underline"
                        href={`/domains/${c.id}`}
                      >
                        {c.asciiFqdn}
                      </Link>
                    </td>
                    <td>
                      <ScoreBar value={c.overallScore} />
                    </td>
                    <td>{fmtScore(c.confidenceScore)}</td>
                    <td>
                      <ScoreBar value={c.riskScore} invert />
                    </td>
                    <td>
                      <Badge value={c.disposition} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Uso dos provedores (7 dias)">
          <table>
            <thead>
              <tr>
                <th>Provedor</th>
                <th>Requisições</th>
                <th>Unidades</th>
                <th>Erros</th>
              </tr>
            </thead>
            <tbody>
              {d.usage.totals.map((t) => (
                <tr key={t.providerKey}>
                  <td>{t.providerKey}</td>
                  <td>{fmtNumber(t.requests)}</td>
                  <td>{fmtNumber(t.units)}</td>
                  <td>{fmtNumber(t.errors)}</td>
                </tr>
              ))}
              {d.usage.totals.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <Empty label="Nenhuma requisição a provedores ainda." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-neutral-500">
            Reaproveitamento (cache) {fmtPercent(d.usage.cache.hitRate)} · análises pagas barradas
            pelo gate {fmtNumber(d.usage.paidSkipped.byCandidateGate)} · aguardando decisão do
            Semrush {fmtNumber(d.usage.paidSkipped.decisionPending)}
          </p>
        </Card>
        <Card title="Erros operacionais recentes">
          {d.recentErrors.length === 0 ? (
            <Empty label="Nenhum erro recente." />
          ) : (
            <ul className="space-y-1 text-sm">
              {d.recentErrors.map((e) => (
                <li key={e.id} className="rounded border border-rose-100 bg-rose-50 px-2 py-1">
                  <span className="font-mono text-xs text-rose-700">
                    {e.component}/{e.code}
                  </span>{" "}
                  <span className="text-neutral-700">{e.message}</span>
                  <span className="ml-2 text-xs text-neutral-400">{fmtDate(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
