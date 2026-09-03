"use client";

import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, qs } from "@/lib/api";
import { fmtDate, fmtNumber, label } from "@/lib/format";
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
        title="Lotes de liberação"
        subtitle="Cada versão distinta de uma fonte vira um lote imutável (arquivo original e SHA-256 preservados)."
      />
      {isAnalyst && (
        <Card title="Importar CSV / lista" className="mb-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <Textarea
                rows={5}
                placeholder={"dominio\nexemplo.com.br\noutro.com.br"}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Input
                placeholder="nome do lote (opcional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={analyze}
                  onChange={(e) => setAnalyze(e.target.checked)}
                />{" "}
                analisar após importar (só etapas locais)
              </label>
              <Button
                variant="primary"
                disabled={!content.trim() || importCsv.isPending}
                onClick={() => importCsv.mutate()}
              >
                Importar
              </Button>
              <ErrorBox error={importCsv.error} />
              {importCsv.data && (
                <div className="text-xs text-neutral-600">
                  {importCsv.data.created ? "Importado" : "Já importado"}:{" "}
                  {importCsv.data.stats.total} domínios, {importCsv.data.stats.newDomains} novos,{" "}
                  {importCsv.data.stats.invalid} inválidos, {importCsv.data.stats.runsCreated}{" "}
                  análises.
                  {importCsv.data.issues.length > 0 && (
                    <ul className="mt-1 max-h-24 overflow-auto font-mono">
                      {importCsv.data.issues.map((i) => (
                        <li key={i.line}>
                          linha {i.line}: {i.raw} · {i.reason}
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
          <Empty label="Nenhum lote ainda." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lote</th>
                <th>Fonte</th>
                <th>Status</th>
                <th>Detectado em</th>
                <th>Publicado em</th>
                <th>Domínios</th>
                <th>Novos</th>
                <th>Inválidos</th>
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
                  <td className="text-xs">{label(b.sourceKey)}</td>
                  <td>
                    <Badge value={b.status} />
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
            <Button onClick={() => q.fetchNextPage()}>Carregar mais</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
