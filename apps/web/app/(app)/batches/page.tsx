"use client";

import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, qs } from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useRole } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Input,
  Loading,
  PageHeader,
  Textarea,
} from "@/components/ui";

interface Batch {
  id: string;
  name: string | null;
  sourceKey: string;
  status: string;
  detectedAt: string;
  publishedAt: string | null;
  domainCount: number;
  newDomainCount: number;
  invalidLineCount: number;
  contentSha256: string;
}

export default function BatchesPage() {
  const qc = useQueryClient();
  const { isAnalyst } = useRole();
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [analyze, setAnalyze] = useState(true);
  const q = useInfiniteQuery({
    queryKey: ["batches"],
    queryFn: ({ pageParam }) =>
      api.get<{ items: Batch[]; nextCursor: string | null }>(
        `/batches${qs({ limit: 50, cursor: pageParam })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const importCsv = useMutation({
    mutationFn: () =>
      api.post<{
        batch: Batch;
        created: boolean;
        stats: Record<string, number>;
        issues: { line: number; raw: string; reason: string }[];
      }>("/batches/import", { content, name: name || undefined, analyze }),
    onSuccess: () => {
      setContent("");
      void qc.invalidateQueries({ queryKey: ["batches"] });
    },
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader
        title="Release Batches"
        subtitle="Every distinct source version is an immutable batch (raw artifact + SHA-256 preserved)."
      />
      {isAnalyst && (
        <Card title="Import CSV / list" className="mb-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <Textarea
                rows={5}
                placeholder={"domain\nexemplo.com.br\noutro.com.br"}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Input
                placeholder="batch name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={analyze}
                  onChange={(e) => setAnalyze(e.target.checked)}
                />{" "}
                analyze after import (local stages only)
              </label>
              <Button
                variant="primary"
                disabled={!content.trim() || importCsv.isPending}
                onClick={() => importCsv.mutate()}
              >
                Import
              </Button>
              <ErrorBox error={importCsv.error} />
              {importCsv.data && (
                <div className="text-xs text-neutral-600">
                  {importCsv.data.created ? "Imported" : "Already imported"}:{" "}
                  {importCsv.data.stats.total} domains, {importCsv.data.stats.newDomains} new,{" "}
                  {importCsv.data.stats.invalid} invalid, {importCsv.data.stats.runsCreated} runs.
                  {importCsv.data.issues.length > 0 && (
                    <ul className="mt-1 max-h-24 overflow-auto font-mono">
                      {importCsv.data.issues.map((i) => (
                        <li key={i.line}>
                          line {i.line}: {i.raw} — {i.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty label="No batches yet." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Source</th>
                <th>Status</th>
                <th>Detected</th>
                <th>Published</th>
                <th>Domains</th>
                <th>New</th>
                <th>Invalid</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link
                      className="font-medium text-sky-700 hover:underline"
                      href={`/batches/${b.id}`}
                    >
                      {b.name ?? b.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="text-xs">{b.sourceKey}</td>
                  <td>
                    <Badge
                      value={b.status}
                      tone={
                        b.status === "failed"
                          ? "bg-rose-100 text-rose-800"
                          : b.status === "analyzing"
                            ? "bg-sky-100 text-sky-800"
                            : "bg-emerald-100 text-emerald-800"
                      }
                    />
                  </td>
                  <td className="text-xs">{fmtDate(b.detectedAt)}</td>
                  <td className="text-xs">{fmtDate(b.publishedAt)}</td>
                  <td>{fmtNumber(b.domainCount)}</td>
                  <td>{fmtNumber(b.newDomainCount)}</td>
                  <td>{fmtNumber(b.invalidLineCount)}</td>
                  <td className="font-mono text-[10px] text-neutral-400">
                    {b.contentSha256.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {q.hasNextPage && (
          <div className="mt-3 text-center">
            <Button onClick={() => q.fetchNextPage()}>Load more</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
