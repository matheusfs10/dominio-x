"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber, fmtScore, label, scoreTone } from "@/lib/format";
import { useRole } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Input,
  KeyValue,
  Loading,
  PageHeader,
  ScoreBar,
  Select,
  Textarea,
} from "@/components/ui";

interface Detail {
  domain: {
    id: string;
    asciiFqdn: string;
    unicodeFqdn: string;
    sld: string;
    tld: string;
    registrableDomain: string;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  summary: {
    latestRunStatus: string | null;
    disposition: string | null;
    manualDisposition: string | null;
    overallScore: number | null;
    confidenceScore: number | null;
    candidateGatePassed: boolean | null;
    tagKeys: string[];
    sourceKeys: string[];
  } | null;
  latestScore: {
    id: string;
    analysisRunId: string;
    scoreModelVersion: number;
    nameScore: number | null;
    brandScore: number | null;
    seoScore: number | null;
    linkScore: number | null;
    historyScore: number | null;
    commercialScore: number | null;
    riskScore: number | null;
    acquisitionScore: number | null;
    confidenceScore: number;
    overallScore: number;
    explanationJson: {
      positive: { signal: string; impact: number; evidence: string }[];
      negative: { signal: string; impact: number; evidence: string }[];
      missing: { signal: string; reason: string }[];
      confidenceFactors: { factor: string; impact: number; detail: string }[];
    };
    createdAt: string;
  } | null;
  runs: {
    id: string;
    status: string;
    triggerType: string;
    createdAt: string;
    completedAt: string | null;
    errorCode: string | null;
    forceDeep: boolean;
    summaryJson: {
      candidateGatePassed?: boolean;
      candidateGateReasons?: string[];
      trafficGatePassed?: boolean;
      trafficGateBlockedBy?: string | null;
      trafficGateReasons?: string[];
      authorityGatePassed?: boolean;
      authorityGateBlockedBy?: string | null;
      authorityGateReasons?: string[];
      rules?: { disposition: string; dispositionReasons: string[] };
    };
  }[];
  tags: { key: string; source: string }[];
  notes: { id: string; body: string; createdAt: string }[];
  dispositions: {
    id: string;
    disposition: string | null;
    note: string | null;
    createdAt: string;
  }[];
  shortlists: { id: string; name: string; note: string | null }[];
  sourceHistory: {
    batchId: string;
    batchName: string | null;
    sourceKey: string;
    detectedAt: string;
    rawValue: string;
    isNew: boolean;
  }[];
}
interface Observation {
  id: string;
  providerKey: string;
  metricKey: string;
  valueType: string;
  valueNumeric: number | null;
  valueText: string | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
  state: string;
  observedAt: string;
  expiresAt: string | null;
  analysisRunId: string | null;
  purgedAt: string | null;
  metadataJson?: unknown;
}
interface TrafficMonth {
  month: string;
  visits: number;
  paidVisits: number;
  serpCount: number;
}
interface RuleExec {
  id: string;
  analysisRunId: string;
  ruleKey: string;
  rulesetVersion: number;
  matched: boolean;
  action: string | null;
  reasonCode: string;
  evidenceJson: {
    leaves: {
      metric: string;
      op: string;
      expected: unknown;
      actual: unknown;
      state: string;
      matched: boolean;
    }[];
  };
  createdAt: string;
}
interface ProviderReq {
  id: string;
  providerKey: string;
  endpointKey: string;
  statusCode: number | null;
  durationMs: number | null;
  unitsUsed: number | null;
  cached: boolean;
  errorCode: string | null;
  startedAt: string;
}

function obsValue(o: Observation): string {
  if (o.purgedAt) return "(removido pela retenção)";
  if (o.state !== "measured") return "";
  if (o.valueType === "numeric") return String(o.valueNumeric);
  if (o.valueType === "boolean") return o.valueBoolean ? "sim" : "não";
  if (o.valueType === "text") return o.valueText ?? "";
  return JSON.stringify(o.valueJson);
}

/**
 * Estimated search traffic for the audience location configured for the provider (Brazil by
 * default). These are estimates derived from ranking positions and search volume, not analytics
 * visits, and they only describe that one location.
 */
function TrafficCard({ items }: { items: Observation[] }) {
  const byKey = new Map(items.map((o) => [o.metricKey, o]));
  const num = (key: string): number | null => {
    const o = byKey.get(key);
    return o && o.state === "measured" ? o.valueNumeric : null;
  };
  const text = (key: string): string | null => {
    const o = byKey.get(key);
    return o && o.state === "measured" ? o.valueText : null;
  };
  const gate = byKey.get("internal.traffic_gate_passed");
  const gateMeta = (gate?.metadataJson ?? {}) as { reasons?: string[] };
  const series = (byKey.get("traffic.monthly_series")?.valueJson ?? null) as TrafficMonth[] | null;
  const total = num("traffic.visits_total");
  const location = text("traffic.location_name") ?? "Brasil";
  const windowMonths = num("traffic.window_months");
  const from = text("traffic.window_from");
  const to = text("traffic.window_to");
  const trend = num("traffic.trend_ratio");
  const title = `Visitantes estimados · ${location}${windowMonths ? ` · ${windowMonths} meses` : ""}`;

  if (!series || series.length === 0) {
    const blocked = gate?.valueBoolean === false;
    return (
      <Card title={title}>
        <Empty
          label={
            blocked
              ? `Consulta paga não realizada — ${(gateMeta.reasons ?? ["barrada pelo gate de tráfego"]).join("; ")}`
              : "Sem dados de tráfego. A consulta paga ainda não rodou para este domínio."
          }
        />
      </Card>
    );
  }

  const peak = Math.max(...series.map((m) => m.visits), 1);
  return (
    <Card title={title}>
      <p className="mb-3 text-xs text-neutral-500">
        Estimativa de visitas vindas da busca orgânica do Google em {location}
        {from && to ? ` entre ${from} e ${to}` : ""}. É uma estimativa (posição no SERP × volume de
        busca), não a medição real de visitantes do site.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <div className="text-xs text-neutral-500">Total no período</div>
          <div className="text-lg font-semibold">{fmtNumber(total)}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Média mensal</div>
          <div className="text-lg font-semibold">
            {fmtNumber(num("traffic.visits_monthly_avg"))}
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Último mês</div>
          <div className="text-lg font-semibold">{fmtNumber(num("traffic.visits_last_month"))}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Tendência (2ª metade / 1ª)</div>
          <div
            className={`text-lg font-semibold ${
              trend === null
                ? "text-neutral-400"
                : trend >= 1
                  ? "text-emerald-700"
                  : "text-rose-700"
            }`}
          >
            {trend === null ? "n/d" : `${trend}×`}
          </div>
        </div>
      </div>
      <div className="flex h-32 items-end gap-2">
        {series.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] text-neutral-600">{fmtNumber(m.visits)}</span>
            <div
              className="w-full rounded-t bg-sky-500"
              style={{ height: `${Math.max(2, (m.visits / peak) * 100)}%` }}
              title={`${m.month}: ${m.visits} visitas estimadas`}
            />
            <span className="text-[10px] text-neutral-500">
              {m.month.slice(5)}/{m.month.slice(2, 4)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-neutral-600 md:grid-cols-4">
        <span>Meses com tráfego: {fmtNumber(num("traffic.months_with_traffic"))}</span>
        <span>Pico mensal: {fmtNumber(num("traffic.visits_peak_month"))}</span>
        <span>Visitas pagas (anúncios): {fmtNumber(num("traffic.paid_visits_total"))}</span>
        <span>SERPs no último mês: {fmtNumber(num("traffic.serp_count_last_month"))}</span>
      </div>
    </Card>
  );
}

/**
 * Domain Rating and the backlink counts behind it, from the Ahrefs index.
 *
 * DR is a vendor score on a 0..100 *logarithmic* scale: going from 20 to 30 is a far smaller
 * jump than going from 70 to 80, and the number is not comparable with any other vendor's
 * authority score nor with the platform's own 0..100 dimensions. It is shown as evidence.
 */
function AuthorityCard({ items }: { items: Observation[] }) {
  const byKey = new Map(items.map((o) => [o.metricKey, o]));
  const num = (key: string): number | null => {
    const o = byKey.get(key);
    return o && o.state === "measured" ? o.valueNumeric : null;
  };
  const text = (key: string): string | null => {
    const o = byKey.get(key);
    return o && o.state === "measured" ? o.valueText : null;
  };
  const gate = byKey.get("internal.authority_gate_passed");
  const gateMeta = (gate?.metadataJson ?? {}) as { reasons?: string[] };
  const dr = num("authority.domain_rating");
  const refDomains = num("authority.referring_domains");
  const backlinks = num("authority.backlinks");
  const dofollowRatio = num("authority.dofollow_ratio");
  const mode = text("authority.mode");
  const target = text("authority.target_url");

  if (dr === null) {
    const blocked = gate?.valueBoolean === false;
    return (
      <Card title="Autoridade de links · Ahrefs">
        <Empty
          label={
            blocked
              ? `Consulta não realizada — ${(gateMeta.reasons ?? ["barrada pelo gate de autoridade"]).join("; ")}`
              : "Sem dados de autoridade. A consulta ainda não rodou para este domínio."
          }
        />
      </Card>
    );
  }

  return (
    <Card title="Autoridade de links · Ahrefs">
      <p className="mb-3 text-xs text-neutral-500">
        Domain Rating é a nota do próprio Ahrefs (0 a 100) para o perfil de domínios que apontam
        para este site. A escala é <strong>logarítmica</strong>: sair de 20 para 30 é muito mais
        fácil que sair de 70 para 80. Não é comparável com a nota de outro fornecedor nem com as
        notas do Dominio-X.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <div className="text-xs text-neutral-500">Domain Rating</div>
          <div className="text-2xl font-semibold">{dr}</div>
          <div className="mt-1 h-1.5 w-full rounded bg-neutral-200">
            <div
              className="h-1.5 rounded bg-amber-500"
              style={{ width: `${Math.min(100, Math.max(0, dr))}%` }}
            />
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Domínios de referência</div>
          <div className="text-lg font-semibold">{fmtNumber(refDomains)}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Backlinks</div>
          <div className="text-lg font-semibold">{fmtNumber(backlinks)}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Domínios dofollow</div>
          <div className="text-lg font-semibold">
            {dofollowRatio === null ? "n/d" : `${Math.round(dofollowRatio * 100)}%`}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs text-neutral-600 md:grid-cols-3">
        <span>Backlinks dofollow: {fmtNumber(num("authority.dofollow_backlinks"))}</span>
        <span>Domínios dofollow: {fmtNumber(num("authority.dofollow_referring_domains"))}</span>
        <span>
          Consulta: {mode ?? "n/d"}
          {target ? ` · ${target}` : ""}
        </span>
      </div>
    </Card>
  );
}

export default function DomainDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { isAnalyst } = useRole();
  const detail = useQuery({
    queryKey: ["domain", id],
    queryFn: () => api.get<Detail>(`/domains/${id}`),
    refetchInterval: (q) =>
      ["queued", "running"].includes(q.state.data?.summary?.latestRunStatus ?? "") ? 3000 : false,
  });
  const observations = useQuery({
    queryKey: ["domain", id, "observations"],
    queryFn: () => api.get<{ items: Observation[] }>(`/domains/${id}/observations`),
  });
  const rules = useQuery({
    queryKey: ["domain", id, "rules"],
    queryFn: () => api.get<{ items: RuleExec[] }>(`/domains/${id}/rules`),
  });
  const providerReqs = useQuery({
    queryKey: ["domain", id, "provider-requests"],
    queryFn: () => api.get<{ items: ProviderReq[] }>(`/domains/${id}/provider-requests`),
  });
  const shortlists = useQuery({
    queryKey: ["shortlists"],
    queryFn: () =>
      api.get<{ items: { id: string; name: string; status: string }[] }>("/shortlists"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["domain", id] });
  const analyze = useMutation({
    mutationFn: (forceDeep: boolean) =>
      api.post(`/domains/${id}/analyze`, { forceDeep, forceRefresh: forceDeep }),
    onSuccess: invalidate,
  });
  const addTag = useMutation({
    mutationFn: (tag: string) => api.post(`/domains/${id}/tags`, { tag }),
    onSuccess: invalidate,
  });
  const removeTag = useMutation({
    mutationFn: (tag: string) => api.delete(`/domains/${id}/tags/${encodeURIComponent(tag)}`),
    onSuccess: invalidate,
  });
  const addNote = useMutation({
    mutationFn: (body: string) => api.post(`/domains/${id}/notes`, { body }),
    onSuccess: invalidate,
  });
  const setDisposition = useMutation({
    mutationFn: (disposition: string) =>
      api.post(`/domains/${id}/disposition`, { disposition: disposition || null }),
    onSuccess: invalidate,
  });
  const addToShortlist = useMutation({
    mutationFn: (shortlistId: string) =>
      api.post(`/shortlists/${shortlistId}/domains`, { domainId: id }),
    onSuccess: invalidate,
  });
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [shortlistId, setShortlistId] = useState("");

  if (detail.isLoading) return <Loading />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const d = detail.data!;
  const s = d.latestScore;
  const latestRun = d.runs[0];
  const dims: [string, number | null | undefined, boolean?][] = s
    ? [
        ["Nome", s.nameScore],
        ["Marca", s.brandScore],
        ["SEO", s.seoScore],
        ["Links", s.linkScore],
        ["Histórico", s.historyScore],
        ["Comercial", s.commercialScore],
        ["Risco", s.riskScore, true],
        ["Aquisição", s.acquisitionScore],
        ["Confiança", s.confidenceScore],
      ]
    : [];
  const mutationError =
    analyze.error ?? addTag.error ?? addNote.error ?? setDisposition.error ?? addToShortlist.error;

  return (
    <div>
      <PageHeader
        title={<span className="font-mono">{d.domain.unicodeFqdn}</span>}
        subtitle={
          <span>
            {d.domain.asciiFqdn !== d.domain.unicodeFqdn && (
              <span className="font-mono">{d.domain.asciiFqdn} · </span>
            )}
            registrável {d.domain.registrableDomain} · visto pela primeira vez em{" "}
            {fmtDate(d.domain.firstSeenAt)} · fontes{" "}
            {d.summary?.sourceKeys.map(label).join(", ") || "—"}
          </span>
        }
        actions={
          isAnalyst && (
            <>
              <Button onClick={() => analyze.mutate(false)} disabled={analyze.isPending}>
                Reanalisar
              </Button>
              <Button
                variant="primary"
                onClick={() => analyze.mutate(true)}
                disabled={analyze.isPending}
              >
                Forçar análise profunda
              </Button>
            </>
          )
        }
      />
      <ErrorBox error={mutationError} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className={`rounded px-2 py-1 text-lg font-semibold ${scoreTone(s?.overallScore)}`}>
          Geral {fmtScore(s?.overallScore)}
        </span>
        <span className={`rounded px-2 py-1 ${scoreTone(s?.confidenceScore)}`}>
          Confiança {fmtScore(s?.confidenceScore)}
        </span>
        <span>
          Status <Badge value={d.summary?.latestRunStatus} />
        </span>
        <span>
          Disposição <Badge value={d.summary?.disposition} />
        </span>
        <span>
          Manual <Badge value={d.summary?.manualDisposition} tone="bg-violet-100 text-violet-800" />
        </span>
        <span>
          Gate{" "}
          {d.summary?.candidateGatePassed === null || d.summary?.candidateGatePassed === undefined
            ? "—"
            : d.summary.candidateGatePassed
              ? "aprovado"
              : "negado"}
        </span>
        <span className="flex flex-wrap gap-1">
          {d.tags.map((t) => (
            <span key={t.key} className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs">
              {t.key}
              {isAnalyst && t.source === "manual" && (
                <button
                  className="ml-1 text-neutral-500 hover:text-rose-600"
                  title="remover tag"
                  onClick={() => removeTag.mutate(t.key)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <TrafficCard items={observations.data?.items ?? []} />
          <AuthorityCard items={observations.data?.items ?? []} />
          <Card
            title={`Notas por dimensão${s ? ` · modelo v${s.scoreModelVersion} · ${fmtDate(s.createdAt)}` : ""}`}
          >
            {!s ? (
              <Empty label="Ainda sem nota. A análise está na fila ou em execução." />
            ) : (
              <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
                {dims.map(([dim, value, invert]) => (
                  <div key={dim} className="rounded border border-neutral-200 p-2">
                    <div className="text-xs text-neutral-500">{dim}</div>
                    <div
                      className={`text-lg font-semibold ${value === null || value === undefined ? "text-neutral-400" : ""}`}
                    >
                      {value === null || value === undefined ? "n/d" : Math.round(value)}
                    </div>
                    <ScoreBar value={value} invert={invert} />
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Por que essa nota?">
            {!s ? (
              <Empty />
            ) : (
              <div className="grid gap-4 md:grid-cols-3 text-sm">
                <div>
                  <h3 className="mb-1 font-medium text-emerald-700">Pontos positivos</h3>
                  <ul className="space-y-1">
                    {s.explanationJson.positive.map((p, i) => (
                      <li key={i}>
                        <span className="font-medium">{p.signal}</span>{" "}
                        <span className="text-emerald-700">+{p.impact}</span>
                        <div className="text-xs text-neutral-500">{p.evidence}</div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1 font-medium text-rose-700">Pontos negativos</h3>
                  <ul className="space-y-1">
                    {s.explanationJson.negative.map((p, i) => (
                      <li key={i}>
                        <span className="font-medium">{p.signal}</span>{" "}
                        <span className="text-rose-700">{p.impact}</span>
                        <div className="text-xs text-neutral-500">{p.evidence}</div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1 font-medium text-neutral-600">Sem evidência</h3>
                  <ul className="space-y-1">
                    {s.explanationJson.missing.map((p, i) => (
                      <li key={i}>
                        <span className="font-medium">{p.signal}</span>
                        <div className="text-xs text-neutral-500">{p.reason}</div>
                      </li>
                    ))}
                  </ul>
                  <h3 className="mb-1 mt-3 font-medium text-neutral-600">Fatores de confiança</h3>
                  <ul className="space-y-1">
                    {s.explanationJson.confidenceFactors.map((f, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-mono">{f.factor}</span> {f.impact >= 0 ? "+" : ""}
                        {f.impact} · {f.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Card>
          <Card title="Observações (mais recentes primeiro)">
            {observations.isLoading ? (
              <Loading />
            ) : (
              <div className="max-h-96 overflow-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Métrica</th>
                      <th>Valor</th>
                      <th>Provedor</th>
                      <th>Estado</th>
                      <th>Observado em</th>
                      <th>Expira em</th>
                      <th>Análise</th>
                    </tr>
                  </thead>
                  <tbody>
                    {observations.data?.items.map((o) => (
                      <tr key={o.id}>
                        <td className="font-mono text-xs">{o.metricKey}</td>
                        <td className="max-w-xs truncate font-mono text-xs">{obsValue(o)}</td>
                        <td className="text-xs">{o.providerKey}</td>
                        <td>
                          <Badge
                            value={o.state}
                            tone={
                              o.state === "measured"
                                ? "bg-emerald-100 text-emerald-800"
                                : o.state === "error"
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-neutral-200 text-neutral-600"
                            }
                          />
                        </td>
                        <td className="text-xs">{fmtDate(o.observedAt)}</td>
                        <td className="text-xs">{o.expiresAt ? fmtDate(o.expiresAt) : "nunca"}</td>
                        <td className="font-mono text-[10px] text-neutral-400">
                          {o.analysisRunId?.slice(0, 8)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Regras (última análise)">
            {rules.isLoading ? (
              <Loading />
            ) : (
              (() => {
                const items = (rules.data?.items ?? []).filter(
                  (r) =>
                    !latestRun ||
                    r.analysisRunId ===
                      (d.summary?.latestRunStatus === "completed" ||
                      d.summary?.latestRunStatus === "partial"
                        ? latestRun.id
                        : r.analysisRunId),
                );
                const lastRunId = items[items.length - 1]?.analysisRunId;
                const latest = items.filter((r) => r.analysisRunId === lastRunId);
                return latest.length === 0 ? (
                  <Empty label="Nenhuma regra executada ainda." />
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Regra</th>
                        <th>Ativou</th>
                        <th>Ação</th>
                        <th>Motivo</th>
                        <th>Evidência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.map((r) => (
                        <tr key={r.id} className={r.matched ? "bg-amber-50/60" : ""}>
                          <td className="font-mono text-xs">
                            {r.ruleKey}{" "}
                            <span className="text-neutral-400">v{r.rulesetVersion}</span>
                          </td>
                          <td>{r.matched ? "sim" : "não"}</td>
                          <td>{r.action ?? "—"}</td>
                          <td className="font-mono text-xs">{r.reasonCode}</td>
                          <td className="text-xs text-neutral-500">
                            {r.evidenceJson.leaves.map((l, i) => (
                              <div key={i}>
                                {l.metric} {l.op} {JSON.stringify(l.expected)} →{" "}
                                {l.state === "measured" ? JSON.stringify(l.actual) : label(l.state)}{" "}
                                {l.matched ? "✓" : "✗"}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {isAnalyst && (
            <Card title="Ações do analista">
              <div className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 text-xs font-medium text-neutral-600">Disposição manual</div>
                  <Select
                    defaultValue={d.summary?.manualDisposition ?? ""}
                    onChange={(e) => setDisposition.mutate(e.target.value)}
                  >
                    <option value="">— nenhuma —</option>
                    {[
                      "interesting",
                      "rejected",
                      "monitoring",
                      "acquisition_target",
                      "acquired",
                    ].map((v) => (
                      <option key={v} value={v}>
                        {label(v)}
                      </option>
                    ))}
                  </Select>
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (tag.trim()) {
                      addTag.mutate(tag.trim());
                      setTag("");
                    }
                  }}
                >
                  <Input
                    placeholder="nova tag"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  />
                  <Button type="submit" size="sm">
                    Marcar
                  </Button>
                </form>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (shortlistId) addToShortlist.mutate(shortlistId);
                  }}
                >
                  <Select value={shortlistId} onChange={(e) => setShortlistId(e.target.value)}>
                    <option value="">adicionar à shortlist…</option>
                    {shortlists.data?.items
                      .filter((l) => l.status === "open")
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </Select>
                  <Button type="submit" size="sm" disabled={!shortlistId}>
                    Adicionar
                  </Button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (note.trim()) {
                      addNote.mutate(note.trim());
                      setNote("");
                    }
                  }}
                >
                  <Textarea
                    rows={3}
                    placeholder="anotação…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button type="submit" size="sm" className="mt-1">
                    Salvar anotação
                  </Button>
                </form>
              </div>
            </Card>
          )}
          <Card title="Histórico de análises">
            <ul className="space-y-2 text-sm">
              {d.runs.map((r) => (
                <li key={r.id} className="rounded border border-neutral-200 p-2">
                  <div className="flex items-center justify-between">
                    <Badge value={r.status} />
                    <span className="text-xs text-neutral-500">{fmtDate(r.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-600">
                    {label(r.triggerType)}
                    {r.forceDeep ? " · profunda" : ""}
                    {r.errorCode ? ` · ${r.errorCode}` : ""}
                  </div>
                  {r.summaryJson.candidateGateReasons && (
                    <div className="text-[11px] text-neutral-500">
                      gate: {r.summaryJson.candidateGatePassed ? "aprovado" : "negado"} ·{" "}
                      {r.summaryJson.candidateGateReasons.join("; ")}
                    </div>
                  )}
                  {r.summaryJson.trafficGateReasons && (
                    <div className="text-[11px] text-neutral-500">
                      tráfego: {r.summaryJson.trafficGatePassed ? "consultado" : "não consultado"}
                      {r.summaryJson.trafficGateBlockedBy
                        ? ` (${label(r.summaryJson.trafficGateBlockedBy)})`
                        : ""}{" "}
                      · {r.summaryJson.trafficGateReasons.join("; ")}
                    </div>
                  )}
                  {r.summaryJson.authorityGateReasons && (
                    <div className="text-[11px] text-neutral-500">
                      autoridade:{" "}
                      {r.summaryJson.authorityGatePassed ? "consultado" : "não consultado"}
                      {r.summaryJson.authorityGateBlockedBy
                        ? ` (${label(r.summaryJson.authorityGateBlockedBy)})`
                        : ""}{" "}
                      · {r.summaryJson.authorityGateReasons.join("; ")}
                    </div>
                  )}
                  <Link
                    className="text-xs text-sky-700 hover:underline"
                    href={`/queue?run=${r.id}`}
                  >
                    detalhes
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Shortlists">
            {d.shortlists.length === 0 ? (
              <Empty label="Não está em nenhuma shortlist." />
            ) : (
              <ul className="text-sm">
                {d.shortlists.map((l) => (
                  <li key={l.id}>
                    <Link className="text-sky-700 hover:underline" href={`/shortlists/${l.id}`}>
                      {l.name}
                    </Link>
                    {l.note && <span className="text-neutral-500"> · {l.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Anotações e disposições">
            <ul className="space-y-1 text-sm">
              {d.dispositions.map((x) => (
                <li key={x.id} className="text-xs text-neutral-600">
                  {fmtDate(x.createdAt)} · disposição →{" "}
                  <b>{x.disposition ? label(x.disposition) : "removida"}</b>
                  {x.note ? ` (${x.note})` : ""}
                </li>
              ))}
              {d.notes.map((n) => (
                <li key={n.id} className="rounded bg-neutral-50 p-2">
                  <div className="text-xs text-neutral-400">{fmtDate(n.createdAt)}</div>
                  {n.body}
                </li>
              ))}
              {d.notes.length === 0 && d.dispositions.length === 0 && (
                <Empty label="Nenhuma anotação." />
              )}
            </ul>
          </Card>
          <Card title="Histórico de fontes">
            <ul className="space-y-1 text-xs">
              {d.sourceHistory.map((h) => (
                <li key={h.batchId}>
                  <Link className="text-sky-700 hover:underline" href={`/batches/${h.batchId}`}>
                    {label(h.sourceKey)}
                  </Link>{" "}
                  · {fmtDate(h.detectedAt)} · original{" "}
                  <span className="font-mono">{h.rawValue}</span>
                  {h.isNew && " · novo"}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Histórico de provedores">
            {providerReqs.data?.items.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Provedor</th>
                    <th>Endpoint</th>
                    <th>Status</th>
                    <th>ms</th>
                    <th>Unidades</th>
                    <th>Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {providerReqs.data.items.map((p) => (
                    <tr key={p.id}>
                      <td>{p.providerKey}</td>
                      <td className="font-mono text-xs">{p.endpointKey}</td>
                      <td>{p.errorCode ?? p.statusCode ?? "ok"}</td>
                      <td>{p.durationMs ?? "—"}</td>
                      <td>{p.unitsUsed ?? "—"}</td>
                      <td className="text-xs">{fmtDate(p.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty label="Nenhuma requisição a provedores." />
            )}
          </Card>
          <Card title="Identidade">
            <KeyValue
              items={[
                [
                  "id",
                  <span key="id" className="font-mono text-xs">
                    {d.domain.id}
                  </span>,
                ],
                ["sld", d.domain.sld],
                ["tld", d.domain.tld],
                ["visto por último", fmtDate(d.domain.lastSeenAt)],
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
