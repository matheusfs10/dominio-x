"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, qs } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader } from "@/components/ui";

interface AuditRow {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  detailsJson: Record<string, unknown>;
  createdAt: string;
}

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["audit", applied],
    queryFn: ({ pageParam }) =>
      api.get<{ items: AuditRow[]; nextCursor: string | null }>(
        `/audit${qs({ action: applied, limit: 100, cursor: pageParam })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader
        title="Auditoria"
        subtitle="Eventos de autenticação, ativações, shortlists, provedores e administração."
        actions={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(action);
            }}
          >
            <Input
              placeholder="ação (ex.: auth.login)"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-56"
            />
            <Button type="submit">Filtrar</Button>
          </form>
        }
      />
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Ação</th>
                <th>Autor</th>
                <th>Alvo</th>
                <th>IP</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDate(r.createdAt)}</td>
                  <td className="font-mono text-xs">{r.action}</td>
                  <td className="text-xs">{r.actorEmail ?? "—"}</td>
                  <td className="font-mono text-[11px]">
                    {r.targetType ? `${r.targetType}:${r.targetId?.slice(0, 8)}` : "—"}
                  </td>
                  <td className="text-xs">{r.ipAddress ?? "—"}</td>
                  <td className="max-w-md truncate font-mono text-[11px] text-neutral-500">
                    {JSON.stringify(r.detailsJson)}
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
