"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber, label } from "@/lib/format";
import { useRole } from "@/components/shell";
import { Badge, Button, Card, ErrorBox, KeyValue, Loading, PageHeader } from "@/components/ui";
import { Funnel } from "@/components/funnel";

interface BatchDetail {
  batch: {
    id: string;
    name: string | null;
    sourceKey: string;
    sourceName: string;
    status: string;
    detectedAt: string;
    publishedAt: string | null;
    contentSha256: string;
    artifactKey: string | null;
    etag: string | null;
    domainCount: number;
    newDomainCount: number;
    invalidLineCount: number;
    metadataJson: {
      parse?: {
        totalLines: number;
        duplicateLines: number;
        issues: { line: number; raw: string; reason: string }[];
        releasePeriodStart?: string;
        releasePeriodEnd?: string;
      };
      contentLength?: number;
    };
  };
  funnel: Record<string, number>;
}

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { isAnalyst } = useRole();
  const q = useQuery({
    queryKey: ["batch", id],
    queryFn: () => api.get<BatchDetail>(`/batches/${id}`),
    refetchInterval: (x) => (x.state.data?.batch.status === "analyzing" ? 5000 : false),
  });
  const analyze = useMutation({
    mutationFn: (onlyNew: boolean) =>
      api.post(`/batches/${id}/analyze`, { onlyNew, forceRefresh: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["batch", id] }),
  });
  const artifact = useMutation({
    mutationFn: () => api.get<{ url: string }>(`/batches/${id}/artifact-url`),
    onSuccess: (r) => window.open(r.url, "_blank", "noopener"),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { batch, funnel } = q.data!;
  const parse = batch.metadataJson.parse;
  return (
    <div>
      <PageHeader
        title={batch.name ?? `${batch.sourceName} · ${fmtDate(batch.detectedAt)}`}
        subtitle={
          <span>
            {label(batch.sourceKey)} · <Badge value={batch.status} />
          </span>
        }
        actions={
          isAnalyst && (
            <>
              <Button onClick={() => artifact.mutate()} disabled={!batch.artifactKey}>
                Arquivo original
              </Button>
              <Button onClick={() => analyze.mutate(true)}>Analisar novos</Button>
              <Button variant="primary" onClick={() => analyze.mutate(false)}>
                Reanalisar todos
              </Button>
              <Link href={`/domains?batchId=${id}`}>
                <Button>Explorar domínios</Button>
              </Link>
            </>
          )
        }
      />
      <ErrorBox error={analyze.error ?? artifact.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Funil">
          <Funnel funnel={funnel} />
        </Card>
        <Card title="Lote">
          <KeyValue
            items={[
              ["detectado em", fmtDate(batch.detectedAt)],
              ["publicado (arquivo gerado em)", fmtDate(batch.publishedAt)],
              [
                "período de liberação",
                parse?.releasePeriodStart
                  ? `${parse.releasePeriodStart} → ${parse.releasePeriodEnd}`
                  : "—",
              ],
              [
                "sha-256",
                <span key="sha" className="font-mono text-xs">
                  {batch.contentSha256}
                </span>,
              ],
              ["etag", batch.etag ?? "—"],
              [
                "arquivo",
                <span key="a" className="font-mono text-xs">
                  {batch.artifactKey ?? "—"}
                </span>,
              ],
              [
                "tamanho",
                batch.metadataJson.contentLength
                  ? `${fmtNumber(batch.metadataJson.contentLength)} bytes`
                  : "—",
              ],
              [
                "linhas",
                parse
                  ? `${fmtNumber(parse.totalLines)} no total · ${fmtNumber(batch.invalidLineCount)} inválidas · ${fmtNumber(parse.duplicateLines)} duplicadas`
                  : "—",
              ],
              [
                "domínios",
                `${fmtNumber(batch.domainCount)} (${fmtNumber(batch.newDomainCount)} novos, ${fmtNumber(funnel.previouslySeen)} já conhecidos)`,
              ],
            ]}
          />
        </Card>
        {parse?.issues?.length ? (
          <Card
            title={`Problemas de leitura (primeiros ${parse.issues.length})`}
            className="lg:col-span-2"
          >
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Conteúdo</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {parse.issues.map((i) => (
                  <tr key={i.line}>
                    <td>{i.line}</td>
                    <td className="font-mono text-xs">{i.raw}</td>
                    <td className="text-xs">{i.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
