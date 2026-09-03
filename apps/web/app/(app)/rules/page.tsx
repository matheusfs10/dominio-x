"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useRole } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from "@/components/ui";

interface Ruleset {
  id: string;
  name: string;
  version: number;
  status: string;
  description: string;
  ruleCount: number;
  createdAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
}

export default function RulesPage() {
  const qc = useQueryClient();
  const { isAnalyst } = useRole();
  const q = useQuery({
    queryKey: ["rulesets"],
    queryFn: () => api.get<{ items: Ruleset[]; operators: string[] }>("/rulesets"),
  });
  const clone = useMutation({
    mutationFn: (id: string) => api.post<{ ruleset: { id: string } }>(`/rulesets/${id}/clone`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rulesets"] }),
  });
  const createDraft = useMutation({
    mutationFn: () =>
      api.post<{ ruleset: { id: string } }>("/rulesets", {
        name: "Novo rascunho",
        description: "",
        rules: [],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rulesets"] }),
  });
  return (
    <div>
      <PageHeader
        title="Regras"
        subtitle="Conjuntos de regras versionados. Versões ativas são imutáveis: clone para um rascunho, edite, teste e depois ative."
        actions={
          isAnalyst && (
            <Button variant="primary" onClick={() => createDraft.mutate()}>
              Novo rascunho vazio
            </Button>
          )
        }
      />
      <ErrorBox error={clone.error ?? createDraft.error} />
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.items.length ? (
          <Empty />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Versão</th>
                <th>Nome</th>
                <th>Status</th>
                <th>Regras</th>
                <th>Criado em</th>
                <th>Ativado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td>v{r.version}</td>
                  <td>
                    <Link
                      className="font-medium text-sky-700 hover:underline"
                      href={`/rules/${r.id}`}
                    >
                      {r.name}
                    </Link>
                    <div className="text-xs text-neutral-500">{r.description}</div>
                  </td>
                  <td>
                    <Badge value={r.status} />
                  </td>
                  <td>{r.ruleCount}</td>
                  <td className="text-xs">{fmtDate(r.createdAt)}</td>
                  <td className="text-xs">{fmtDate(r.activatedAt)}</td>
                  <td>
                    {isAnalyst && (
                      <Button size="sm" onClick={() => clone.mutate(r.id)}>
                        Clonar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {q.data && (
          <p className="mt-3 text-xs text-neutral-500">
            Operadores: {q.data.operators.join(", ")}. Ações: reject, quarantine, warn, tag,
            score_adjustment, candidate_allow, candidate_deny.
          </p>
        )}
      </Card>
    </div>
  );
}
