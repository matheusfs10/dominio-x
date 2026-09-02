"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
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
            {batch.sourceKey} ·{" "}
            <Badge value={batch.status} tone="bg-neutral-200 text-neutral-700" />
          </span>
        }
        actions={
          isAnalyst && (
            <>
              <Button onClick={() => artifact.mutate()} disabled={!batch.artifactKey}>
                Raw artifact
              </Button>
              <Button onClick={() => analyze.mutate(true)}>Analyze new</Button>
              <Button variant="primary" onClick={() => analyze.mutate(false)}>
                Re-analyze all
              </Button>
              <Link href={`/domains?batchId=${id}`}>
                <Button>Explore domains</Button>
              </Link>
            </>
          )
        }
      />
      <ErrorBox error={analyze.error ?? artifact.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Funnel">
          <Funnel funnel={funnel} />
        </Card>
        <Card title="Batch">
          <KeyValue
            items={[
              ["detected", fmtDate(batch.detectedAt)],
              ["published (file generated)", fmtDate(batch.publishedAt)],
              [
                "release period",
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
                "artifact",
                <span key="a" className="font-mono text-xs">
                  {batch.artifactKey ?? "—"}
                </span>,
              ],
              [
                "size",
                batch.metadataJson.contentLength
                  ? `${fmtNumber(batch.metadataJson.contentLength)} bytes`
                  : "—",
              ],
              [
                "lines",
                parse
                  ? `${fmtNumber(parse.totalLines)} total · ${fmtNumber(batch.invalidLineCount)} invalid · ${fmtNumber(parse.duplicateLines)} duplicate`
                  : "—",
              ],
              [
                "domains",
                `${fmtNumber(batch.domainCount)} (${fmtNumber(batch.newDomainCount)} new, ${fmtNumber(funnel.previouslySeen)} previously seen)`,
              ],
            ]}
          />
        </Card>
        {parse?.issues?.length ? (
          <Card title={`Parse issues (first ${parse.issues.length})`} className="lg:col-span-2">
            <table>
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Raw</th>
                  <th>Reason</th>
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
