"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtScore } from "@/lib/format";
import { useRole } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  ScoreBar,
  Select,
} from "@/components/ui";

interface Detail {
  shortlist: { id: string; name: string; description: string | null; status: string };
  domains: {
    domainId: string;
    rank: number | null;
    note: string | null;
    createdAt: string;
    domain: { id: string; asciiFqdn: string; unicodeFqdn: string };
    summary: {
      overallScore: number | null;
      confidenceScore: number | null;
      riskScore: number | null;
      disposition: string | null;
      manualDisposition: string | null;
    } | null;
  }[];
}

export default function ShortlistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { isAnalyst } = useRole();
  const q = useQuery({
    queryKey: ["shortlist", id],
    queryFn: () => api.get<Detail>(`/shortlists/${id}`),
  });
  const remove = useMutation({
    mutationFn: (domainId: string) => api.delete(`/shortlists/${id}/domains/${domainId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shortlist", id] }),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/shortlists/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shortlist", id] }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  return (
    <div>
      <PageHeader
        title={d.shortlist.name}
        subtitle={d.shortlist.description ?? undefined}
        actions={
          <>
            {isAnalyst && (
              <Select
                value={d.shortlist.status}
                onChange={(e) => setStatus.mutate(e.target.value)}
                className="w-32"
              >
                {["open", "closed", "archived"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
            <a href={`/api/v1/shortlists/${id}/export.csv`}>
              <Button>Export CSV</Button>
            </a>
          </>
        }
      />
      <ErrorBox error={remove.error ?? setStatus.error} />
      <Card>
        {d.domains.length === 0 ? (
          <Empty label="No domains in this shortlist. Add them from a domain page." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Domain</th>
                <th>Overall</th>
                <th>Conf.</th>
                <th>Risk</th>
                <th>Disposition</th>
                <th>Note</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {d.domains.map((r) => (
                <tr key={r.domainId}>
                  <td>{r.rank ?? "—"}</td>
                  <td>
                    <Link
                      className="font-medium text-sky-700 hover:underline"
                      href={`/domains/${r.domain.id}`}
                    >
                      {r.domain.unicodeFqdn}
                    </Link>
                  </td>
                  <td>
                    <ScoreBar value={r.summary?.overallScore} />
                  </td>
                  <td>{fmtScore(r.summary?.confidenceScore)}</td>
                  <td>
                    <ScoreBar value={r.summary?.riskScore} invert />
                  </td>
                  <td>
                    <Badge value={r.summary?.manualDisposition ?? r.summary?.disposition} />
                  </td>
                  <td className="text-xs">{r.note}</td>
                  <td className="text-xs">{fmtDate(r.createdAt)}</td>
                  <td>
                    {isAnalyst && (
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.domainId)}>
                        remove
                      </Button>
                    )}
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
