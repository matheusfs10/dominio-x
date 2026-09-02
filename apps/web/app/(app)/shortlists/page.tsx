"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useRole } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader } from "@/components/ui";

interface Shortlist {
  id: string;
  name: string;
  description: string | null;
  status: string;
  domainCount: number;
  updatedAt: string;
}

export default function ShortlistsPage() {
  const qc = useQueryClient();
  const { isAnalyst } = useRole();
  const [name, setName] = useState("");
  const q = useQuery({
    queryKey: ["shortlists"],
    queryFn: () => api.get<{ items: Shortlist[] }>("/shortlists"),
  });
  const create = useMutation({
    mutationFn: () => api.post("/shortlists", { name }),
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["shortlists"] });
    },
  });
  return (
    <div>
      <PageHeader
        title="Shortlists"
        actions={
          isAnalyst && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
              }}
            >
              <Input
                placeholder="new shortlist name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-56"
                name="shortlist-name"
              />
              <Button type="submit" variant="primary">
                Create
              </Button>
            </form>
          )
        }
      />
      <ErrorBox error={create.error} />
      <Card>
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.items.length ? (
          <Empty label="No shortlists yet." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Domains</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link
                      className="font-medium text-sky-700 hover:underline"
                      href={`/shortlists/${s.id}`}
                    >
                      {s.name}
                    </Link>
                    <div className="text-xs text-neutral-500">{s.description}</div>
                  </td>
                  <td>
                    <Badge value={s.status} tone="bg-neutral-200 text-neutral-700" />
                  </td>
                  <td>{s.domainCount}</td>
                  <td className="text-xs">{fmtDate(s.updatedAt)}</td>
                  <td>
                    <a
                      className="text-xs text-sky-700 hover:underline"
                      href={`/api/v1/shortlists/${s.id}/export.csv`}
                    >
                      CSV
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
