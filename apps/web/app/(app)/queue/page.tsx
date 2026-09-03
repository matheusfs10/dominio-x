"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { api, qs } from "@/lib/api";
import { fmtDate, fmtNumber, label } from "@/lib/format";
import { useRole } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Select } from "@/components/ui";

interface Run {
  id: string;
  domainId: string;
  asciiFqdn: string;
  status: string;
  triggerType: string;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  errorMessageSanitized: string | null;
  forceDeep: boolean;
}
interface RunDetail {
  run: Run & { summaryJson: Record<string, unknown> };
  steps: {
    id: string;
    stepKey: string;
    providerKey: string | null;
    status: string;
    durationMs: number | null;
    errorCode: string | null;
    metadataJson: Record<string, unknown>;
    startedAt: string | null;
  }[];
}

function QueueInner() {
  const qc = useQueryClient();
  const { isAnalyst } = useRole();
  const params = useSearchParams();
  const selectedRun = params.get("run");
  const [status, setStatus] = useState("failed");
  const counts = useQuery({
    queryKey: ["queue"],
    queryFn: () =>
      api.get<{
        stages: {
          stage: string;
          queue: string;
          waiting: number;
          active: number;
          delayed: number;
          failed: number;
          completed: number;
          prioritized: number;
        }[];
        crawler: Record<string, number>;
      }>("/queue"),
    refetchInterval: 5000,
  });
  const runs = useInfiniteQuery({
    queryKey: ["runs", status],
    queryFn: ({ pageParam }) =>
      api.get<{ items: Run[]; nextCursor: string | null }>(
        `/analysis-runs${qs({ status, limit: 50, cursor: pageParam })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    refetchInterval: 10_000,
  });
  const detail = useQuery({
    queryKey: ["run", selectedRun],
    queryFn: () => api.get<RunDetail>(`/analysis-runs/${selectedRun}`),
    enabled: Boolean(selectedRun),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/analysis-runs/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }),
  });
  const rows = runs.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader
        title="Fila de análise"
        subtitle="Contadores das filas por etapa e estado persistido das análises. Análises com falha podem ser repetidas (cria-se uma nova; o histórico nunca é reescrito)."
      />
      <ErrorBox error={retry.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Etapas" className="lg:col-span-2">
          {counts.isLoading ? (
            <Loading />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Aguardando</th>
                  <th>Priorizadas</th>
                  <th>Em execução</th>
                  <th>Agendadas</th>
                  <th>Falhas</th>
                  <th>Concluídas (retidas)</th>
                </tr>
              </thead>
              <tbody>
                {counts.data?.stages.map((s) => (
                  <tr key={s.stage}>
                    <td className="text-xs">
                      {label(s.stage)} <span className="font-mono text-neutral-400">{s.stage}</span>
                    </td>
                    <td>{fmtNumber(s.waiting)}</td>
                    <td>{fmtNumber(s.prioritized)}</td>
                    <td>{fmtNumber(s.active)}</td>
                    <td>{fmtNumber(s.delayed)}</td>
                    <td className={s.failed ? "text-rose-700" : ""}>{fmtNumber(s.failed)}</td>
                    <td>{fmtNumber(s.completed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Tarefas do crawler (projeto isolado)">
          {counts.data ? (
            <ul className="text-sm">
              {Object.entries(counts.data.crawler).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{label(k)}</span>
                  <span className="tabular-nums">{fmtNumber(v)}</span>
                </li>
              ))}
              {Object.keys(counts.data.crawler).length === 0 && (
                <Empty label="Nenhuma tarefa de crawler." />
              )}
            </ul>
          ) : (
            <Loading />
          )}
        </Card>
        <Card
          title="Análises"
          className="lg:col-span-2"
          actions={
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              {["failed", "partial", "queued", "running", "completed"].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          }
        >
          {runs.isLoading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty label={`Nenhuma análise com status "${label(status)}".`} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Domínio</th>
                  <th>Gatilho</th>
                  <th>Status</th>
                  <th>Erro</th>
                  <th>Criada em</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        className="text-sky-700 hover:underline"
                        href={`/domains/${r.domainId}`}
                      >
                        {r.asciiFqdn}
                      </Link>
                    </td>
                    <td className="text-xs">
                      {label(r.triggerType)}
                      {r.forceDeep ? " · profunda" : ""}
                    </td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td className="text-xs text-rose-700">
                      {r.errorCode}
                      {r.errorMessageSanitized ? ` · ${r.errorMessageSanitized.slice(0, 80)}` : ""}
                    </td>
                    <td className="text-xs">{fmtDate(r.createdAt)}</td>
                    <td className="whitespace-nowrap">
                      <Link
                        className="text-xs text-sky-700 hover:underline"
                        href={`/queue?run=${r.id}`}
                      >
                        etapas
                      </Link>
                      {isAnalyst && ["failed", "partial"].includes(r.status) && (
                        <Button size="sm" className="ml-2" onClick={() => retry.mutate(r.id)}>
                          Repetir
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {runs.hasNextPage && (
            <div className="mt-3 text-center">
              <Button onClick={() => runs.fetchNextPage()}>Carregar mais</Button>
            </div>
          )}
        </Card>
        <Card title="Etapas da análise">
          {!selectedRun ? (
            <Empty label="Selecione uma análise." />
          ) : detail.isLoading ? (
            <Loading />
          ) : detail.error ? (
            <ErrorBox error={detail.error} />
          ) : (
            <div className="text-sm">
              <div className="mb-2 text-xs text-neutral-500">
                análise <span className="font-mono">{detail.data!.run.id}</span> ·{" "}
                {detail.data!.run.asciiFqdn} · <Badge value={detail.data!.run.status} />
              </div>
              <ul className="space-y-1">
                {detail.data!.steps.map((s) => (
                  <li key={s.id} className="rounded border border-neutral-200 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs">
                        {label(s.stepKey)}
                        {s.providerKey ? (
                          <span className="font-mono text-neutral-400"> ({s.providerKey})</span>
                        ) : (
                          ""
                        )}
                      </span>
                      <Badge value={s.status} />
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      {s.durationMs ?? "—"} ms{s.errorCode ? ` · ${s.errorCode}` : ""} ·{" "}
                      {JSON.stringify(s.metadataJson).slice(0, 160)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function QueuePage() {
  return (
    <Suspense>
      <QueueInner />
    </Suspense>
  );
}
