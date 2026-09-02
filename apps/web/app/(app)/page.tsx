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
        title="Overview"
        subtitle="Operational snapshot of ingestion, analysis and provider usage."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="Domains known"
          value={fmtNumber(d.domains.known)}
          hint={`${fmtNumber(d.domains.newLast24h)} new in 24h`}
        />
        <Stat
          label="Domains analyzed"
          value={fmtNumber(d.domains.analyzed)}
          hint={`${fmtNumber(d.domains.highScore)} scored ≥ 70`}
        />
        <Stat
          label="Queue depth"
          value={fmtNumber(d.queue.depth)}
          hint={`${d.queue.active} active · crawler pending ${d.queue.crawler.pending ?? 0}`}
        />
        <Stat
          label="Runs (24h)"
          value={`${fmtNumber(r24.completed)} ✓`}
          hint={`${r24.partial ?? 0} partial · ${r24.failed ?? 0} failed · ${(r24.queued ?? 0) + (r24.running ?? 0)} open`}
        />
        <Stat
          label="Semrush units"
          value={fmtNumber(d.usage.semrush.unitsThisMonth)}
          hint={
            d.usage.semrush.monthlyBudget
              ? `${fmtPercent(d.usage.semrush.utilization)} of ${fmtNumber(d.usage.semrush.monthlyBudget)}`
              : "no budget configured"
          }
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Latest Registro.br batch"
          actions={
            d.latestBatch && (
              <Link
                className="text-xs text-sky-700 hover:underline"
                href={`/batches/${d.latestBatch.batch.id}`}
              >
                Open
              </Link>
            )
          }
        >
          {d.latestBatch ? (
            <div>
              <div className="mb-3 text-sm text-neutral-600">
                Detected {fmtDate(d.latestBatch.batch.detectedAt)} ·{" "}
                {fmtNumber(d.latestBatch.batch.domainCount)} domains ·{" "}
                <Badge value={d.latestBatch.batch.status} />
              </div>
              <Funnel funnel={d.latestBatch.funnel} />
            </div>
          ) : (
            <Empty label="No Registro.br batch ingested yet. The scheduler runs every 6 hours." />
          )}
        </Card>
        <Card title="High-score candidates">
          {d.topCandidates.length === 0 ? (
            <Empty label="No scored domains yet." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Overall</th>
                  <th>Confidence</th>
                  <th>Risk</th>
                  <th>Disposition</th>
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
        <Card title="Provider usage (7 days)">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Requests</th>
                <th>Units</th>
                <th>Errors</th>
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
                    <Empty label="No provider requests yet." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-neutral-500">
            Cache hit rate {fmtPercent(d.usage.cache.hitRate)} · paid analyses skipped by gate{" "}
            {fmtNumber(d.usage.paidSkipped.byCandidateGate)} · Semrush decision pending{" "}
            {fmtNumber(d.usage.paidSkipped.decisionPending)}
          </p>
        </Card>
        <Card title="Recent operational errors">
          {d.recentErrors.length === 0 ? (
            <Empty label="No recent errors." />
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
