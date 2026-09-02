"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDate, fmtScore, scoreTone } from "@/lib/format";
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
  if (o.purgedAt) return "(purged by retention)";
  if (o.state !== "measured") return "";
  if (o.valueType === "numeric") return String(o.valueNumeric);
  if (o.valueType === "boolean") return String(o.valueBoolean);
  if (o.valueType === "text") return o.valueText ?? "";
  return JSON.stringify(o.valueJson);
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
        ["Name", s.nameScore],
        ["Brand", s.brandScore],
        ["SEO", s.seoScore],
        ["Link", s.linkScore],
        ["History", s.historyScore],
        ["Commercial", s.commercialScore],
        ["Risk", s.riskScore, true],
        ["Acquisition", s.acquisitionScore],
        ["Confidence", s.confidenceScore],
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
            registrable {d.domain.registrableDomain} · first seen {fmtDate(d.domain.firstSeenAt)} ·
            sources {d.summary?.sourceKeys.join(", ") || "—"}
          </span>
        }
        actions={
          isAnalyst && (
            <>
              <Button onClick={() => analyze.mutate(false)} disabled={analyze.isPending}>
                Reanalyze
              </Button>
              <Button
                variant="primary"
                onClick={() => analyze.mutate(true)}
                disabled={analyze.isPending}
              >
                Force deep analysis
              </Button>
            </>
          )
        }
      />
      <ErrorBox error={mutationError} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className={`rounded px-2 py-1 text-lg font-semibold ${scoreTone(s?.overallScore)}`}>
          Overall {fmtScore(s?.overallScore)}
        </span>
        <span className={`rounded px-2 py-1 ${scoreTone(s?.confidenceScore)}`}>
          Confidence {fmtScore(s?.confidenceScore)}
        </span>
        <span>
          Status <Badge value={d.summary?.latestRunStatus} />
        </span>
        <span>
          Disposition <Badge value={d.summary?.disposition} />
        </span>
        <span>
          Manual <Badge value={d.summary?.manualDisposition} tone="bg-violet-100 text-violet-800" />
        </span>
        <span>
          Gate{" "}
          {d.summary?.candidateGatePassed === null || d.summary?.candidateGatePassed === undefined
            ? "—"
            : d.summary.candidateGatePassed
              ? "passed"
              : "denied"}
        </span>
        <span className="flex flex-wrap gap-1">
          {d.tags.map((t) => (
            <span key={t.key} className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs">
              {t.key}
              {isAnalyst && t.source === "manual" && (
                <button
                  className="ml-1 text-neutral-500 hover:text-rose-600"
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
          <Card
            title={`Score cards${s ? ` · model v${s.scoreModelVersion} · ${fmtDate(s.createdAt)}` : ""}`}
          >
            {!s ? (
              <Empty label="No score yet. The analysis is queued or running." />
            ) : (
              <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
                {dims.map(([label, value, invert]) => (
                  <div key={label} className="rounded border border-neutral-200 p-2">
                    <div className="text-xs text-neutral-500">{label}</div>
                    <div
                      className={`text-lg font-semibold ${value === null || value === undefined ? "text-neutral-400" : ""}`}
                    >
                      {value === null || value === undefined ? "n/a" : Math.round(value)}
                    </div>
                    <ScoreBar value={value} invert={invert} />
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Why this score?">
            {!s ? (
              <Empty />
            ) : (
              <div className="grid gap-4 md:grid-cols-3 text-sm">
                <div>
                  <h3 className="mb-1 font-medium text-emerald-700">Positive</h3>
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
                  <h3 className="mb-1 font-medium text-rose-700">Negative</h3>
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
                  <h3 className="mb-1 font-medium text-neutral-600">Missing</h3>
                  <ul className="space-y-1">
                    {s.explanationJson.missing.map((p, i) => (
                      <li key={i}>
                        <span className="font-medium">{p.signal}</span>
                        <div className="text-xs text-neutral-500">{p.reason}</div>
                      </li>
                    ))}
                  </ul>
                  <h3 className="mb-1 mt-3 font-medium text-neutral-600">Confidence factors</h3>
                  <ul className="space-y-1">
                    {s.explanationJson.confidenceFactors.map((f, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-mono">{f.factor}</span> {f.impact >= 0 ? "+" : ""}
                        {f.impact} — {f.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Card>
          <Card title="Observations (latest first)">
            {observations.isLoading ? (
              <Loading />
            ) : (
              <div className="max-h-96 overflow-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                      <th>Provider</th>
                      <th>State</th>
                      <th>Observed</th>
                      <th>Expires</th>
                      <th>Run</th>
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
                        <td className="text-xs">{o.expiresAt ? fmtDate(o.expiresAt) : "never"}</td>
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
          <Card title="Rules (latest run)">
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
                  <Empty label="No rule executions yet." />
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Rule</th>
                        <th>Matched</th>
                        <th>Action</th>
                        <th>Reason</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.map((r) => (
                        <tr key={r.id} className={r.matched ? "bg-amber-50/60" : ""}>
                          <td className="font-mono text-xs">
                            {r.ruleKey}{" "}
                            <span className="text-neutral-400">v{r.rulesetVersion}</span>
                          </td>
                          <td>{r.matched ? "yes" : "no"}</td>
                          <td>{r.action ?? "—"}</td>
                          <td className="font-mono text-xs">{r.reasonCode}</td>
                          <td className="text-xs text-neutral-500">
                            {r.evidenceJson.leaves.map((l, i) => (
                              <div key={i}>
                                {l.metric} {l.op} {JSON.stringify(l.expected)} →{" "}
                                {l.state === "measured" ? JSON.stringify(l.actual) : l.state}{" "}
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
            <Card title="Analyst actions">
              <div className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 text-xs font-medium text-neutral-600">
                    Manual disposition
                  </div>
                  <Select
                    defaultValue={d.summary?.manualDisposition ?? ""}
                    onChange={(e) => setDisposition.mutate(e.target.value)}
                  >
                    <option value="">— none —</option>
                    {[
                      "interesting",
                      "rejected",
                      "monitoring",
                      "acquisition_target",
                      "acquired",
                    ].map((v) => (
                      <option key={v} value={v}>
                        {v}
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
                    placeholder="add tag"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  />
                  <Button type="submit" size="sm">
                    Tag
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
                    <option value="">add to shortlist…</option>
                    {shortlists.data?.items
                      .filter((l) => l.status === "open")
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </Select>
                  <Button type="submit" size="sm" disabled={!shortlistId}>
                    Add
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
                    placeholder="note…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button type="submit" size="sm" className="mt-1">
                    Add note
                  </Button>
                </form>
              </div>
            </Card>
          )}
          <Card title="Analysis history">
            <ul className="space-y-2 text-sm">
              {d.runs.map((r) => (
                <li key={r.id} className="rounded border border-neutral-200 p-2">
                  <div className="flex items-center justify-between">
                    <Badge value={r.status} />
                    <span className="text-xs text-neutral-500">{fmtDate(r.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-600">
                    {r.triggerType}
                    {r.forceDeep ? " · deep" : ""}
                    {r.errorCode ? ` · ${r.errorCode}` : ""}
                  </div>
                  {r.summaryJson.candidateGateReasons && (
                    <div className="text-[11px] text-neutral-500">
                      gate: {r.summaryJson.candidateGatePassed ? "passed" : "denied"} —{" "}
                      {r.summaryJson.candidateGateReasons.join("; ")}
                    </div>
                  )}
                  <Link
                    className="text-xs text-sky-700 hover:underline"
                    href={`/queue?run=${r.id}`}
                  >
                    details
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Shortlists">
            {d.shortlists.length === 0 ? (
              <Empty label="Not shortlisted." />
            ) : (
              <ul className="text-sm">
                {d.shortlists.map((l) => (
                  <li key={l.id}>
                    <Link className="text-sky-700 hover:underline" href={`/shortlists/${l.id}`}>
                      {l.name}
                    </Link>
                    {l.note && <span className="text-neutral-500"> — {l.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Notes & dispositions">
            <ul className="space-y-1 text-sm">
              {d.dispositions.map((x) => (
                <li key={x.id} className="text-xs text-neutral-600">
                  {fmtDate(x.createdAt)} · disposition → <b>{x.disposition ?? "cleared"}</b>
                  {x.note ? ` (${x.note})` : ""}
                </li>
              ))}
              {d.notes.map((n) => (
                <li key={n.id} className="rounded bg-neutral-50 p-2">
                  <div className="text-xs text-neutral-400">{fmtDate(n.createdAt)}</div>
                  {n.body}
                </li>
              ))}
              {d.notes.length === 0 && d.dispositions.length === 0 && <Empty label="No notes." />}
            </ul>
          </Card>
          <Card title="Source history">
            <ul className="space-y-1 text-xs">
              {d.sourceHistory.map((h) => (
                <li key={h.batchId}>
                  <Link className="text-sky-700 hover:underline" href={`/batches/${h.batchId}`}>
                    {h.sourceKey}
                  </Link>{" "}
                  · {fmtDate(h.detectedAt)} · raw <span className="font-mono">{h.rawValue}</span>
                  {h.isNew && " · new"}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Provider history">
            {providerReqs.data?.items.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Endpoint</th>
                    <th>Status</th>
                    <th>ms</th>
                    <th>Units</th>
                    <th>At</th>
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
              <Empty label="No provider requests." />
            )}
          </Card>
          <Card title="Identity">
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
                ["last seen", fmtDate(d.domain.lastSeenAt)],
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
