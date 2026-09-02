"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, qs } from "@/lib/api";
import { fmtDate, fmtScore } from "@/lib/format";
import { useRole } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Input,
  Label,
  Loading,
  PageHeader,
  ScoreBar,
  Select,
} from "@/components/ui";

interface DomainRow {
  id: string;
  asciiFqdn: string;
  unicodeFqdn: string;
  tld: string;
  firstSeenAt: string;
  summary: {
    latestRunStatus: string | null;
    disposition: string | null;
    manualDisposition: string | null;
    overallScore: number | null;
    confidenceScore: number | null;
    nameScore: number | null;
    seoScore: number | null;
    riskScore: number | null;
    dnsResolves: boolean | null;
    httpStatus: number | null;
    hasSeoData: boolean | null;
    shortlistCount: number;
    tagKeys: string[];
    sourceKeys: string[];
    digitCount: number | null;
    hyphenCount: number | null;
  } | null;
}

const DEFAULT_FILTERS = {
  q: "",
  tld: "",
  sourceKey: "",
  analysisStatus: "",
  disposition: "",
  manualDisposition: "",
  minOverall: "",
  maxRisk: "",
  minConfidence: "",
  hasDns: "",
  hasSeo: "",
  shortlisted: "",
  maxDigits: "",
  maxHyphens: "",
  maxLength: "",
  httpStatus: "",
  tag: "",
  sort: "first_seen_at",
  order: "desc",
};

export default function DomainsPage() {
  const router = useRouter();
  const { isAnalyst } = useRole();
  const [draft, setDraft] = useState(DEFAULT_FILTERS);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [newDomain, setNewDomain] = useState("");
  const [forceDeep, setForceDeep] = useState(false);

  const query = useInfiniteQuery({
    queryKey: ["domains", filters],
    queryFn: ({ pageParam }) =>
      api.get<{ items: DomainRow[]; nextCursor: string | null }>(
        `/domains${qs({ ...filters, limit: 50, cursor: pageParam })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const create = useMutation({
    mutationFn: (domain: string) =>
      api.post<{ domain: { id: string }; run: { id: string } | null }>("/domains", {
        domain,
        analyze: true,
        forceDeep,
      }),
    onSuccess: (res) => router.push(`/domains/${res.domain.id}`),
  });

  function set<K extends keyof typeof DEFAULT_FILTERS>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  function apply(e: FormEvent) {
    e.preventDefault();
    setFilters(draft);
  }
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader
        title="Domains"
        subtitle="Server-side filtered explorer. Scores reflect the latest completed analysis."
        actions={
          isAnalyst && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newDomain.trim()) create.mutate(newDomain.trim());
              }}
            >
              <Input
                placeholder="exemplo.com.br"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="w-56"
                name="domain"
              />
              <label className="flex items-center gap-1 text-xs text-neutral-600">
                <input
                  type="checkbox"
                  checked={forceDeep}
                  onChange={(e) => setForceDeep(e.target.checked)}
                />{" "}
                deep
              </label>
              <Button type="submit" variant="primary" disabled={create.isPending}>
                Analyze
              </Button>
            </form>
          )
        }
      />
      <ErrorBox error={create.error} />
      <Card className="mb-4">
        <form onSubmit={apply} className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2">
            <Label>Search</Label>
            <Input
              value={draft.q}
              onChange={(e) => set("q", e.target.value)}
              placeholder="fqdn contains…"
              name="q"
            />
          </div>
          <div>
            <Label>TLD</Label>
            <Input
              value={draft.tld}
              onChange={(e) => set("tld", e.target.value)}
              placeholder="com.br"
            />
          </div>
          <div>
            <Label>Source</Label>
            <Select value={draft.sourceKey} onChange={(e) => set("sourceKey", e.target.value)}>
              <option value="">any</option>
              <option value="registro_br_release">registro_br_release</option>
              <option value="manual">manual</option>
              <option value="csv_import">csv_import</option>
            </Select>
          </div>
          <div>
            <Label>Analysis status</Label>
            <Select
              value={draft.analysisStatus}
              onChange={(e) => set("analysisStatus", e.target.value)}
            >
              <option value="">any</option>
              {["queued", "running", "completed", "partial", "failed"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Disposition</Label>
            <Select value={draft.disposition} onChange={(e) => set("disposition", e.target.value)}>
              <option value="">any</option>
              {["accepted", "needs_review", "quarantined", "rejected"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Manual disposition</Label>
            <Select
              value={draft.manualDisposition}
              onChange={(e) => set("manualDisposition", e.target.value)}
            >
              <option value="">any</option>
              {["interesting", "rejected", "monitoring", "acquisition_target", "acquired"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ),
              )}
            </Select>
          </div>
          <div>
            <Label>Min overall</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.minOverall}
              onChange={(e) => set("minOverall", e.target.value)}
            />
          </div>
          <div>
            <Label>Min confidence</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.minConfidence}
              onChange={(e) => set("minConfidence", e.target.value)}
            />
          </div>
          <div>
            <Label>Max risk</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.maxRisk}
              onChange={(e) => set("maxRisk", e.target.value)}
            />
          </div>
          <div>
            <Label>Max digits</Label>
            <Input
              type="number"
              min={0}
              value={draft.maxDigits}
              onChange={(e) => set("maxDigits", e.target.value)}
            />
          </div>
          <div>
            <Label>Max hyphens</Label>
            <Input
              type="number"
              min={0}
              value={draft.maxHyphens}
              onChange={(e) => set("maxHyphens", e.target.value)}
            />
          </div>
          <div>
            <Label>Max length</Label>
            <Input
              type="number"
              min={1}
              value={draft.maxLength}
              onChange={(e) => set("maxLength", e.target.value)}
            />
          </div>
          <div>
            <Label>DNS</Label>
            <Select value={draft.hasDns} onChange={(e) => set("hasDns", e.target.value)}>
              <option value="">any</option>
              <option value="true">resolves</option>
              <option value="false">no</option>
            </Select>
          </div>
          <div>
            <Label>Semrush data</Label>
            <Select value={draft.hasSeo} onChange={(e) => set("hasSeo", e.target.value)}>
              <option value="">any</option>
              <option value="true">present</option>
              <option value="false">absent</option>
            </Select>
          </div>
          <div>
            <Label>HTTP status</Label>
            <Input
              type="number"
              value={draft.httpStatus}
              onChange={(e) => set("httpStatus", e.target.value)}
            />
          </div>
          <div>
            <Label>Shortlisted</Label>
            <Select value={draft.shortlisted} onChange={(e) => set("shortlisted", e.target.value)}>
              <option value="">any</option>
              <option value="true">yes</option>
              <option value="false">no</option>
            </Select>
          </div>
          <div>
            <Label>Tag</Label>
            <Input value={draft.tag} onChange={(e) => set("tag", e.target.value)} />
          </div>
          <div>
            <Label>Sort</Label>
            <Select value={draft.sort} onChange={(e) => set("sort", e.target.value)}>
              {[
                "first_seen_at",
                "last_seen_at",
                "ascii_fqdn",
                "overall_score",
                "confidence_score",
                "name_score",
                "seo_score",
                "risk_score",
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Order</Label>
            <Select value={draft.order} onChange={(e) => set("order", e.target.value)}>
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="primary">
              Apply
            </Button>
            <Button
              type="button"
              onClick={() => {
                setDraft(DEFAULT_FILTERS);
                setFilters(DEFAULT_FILTERS);
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorBox error={query.error} />
        ) : rows.length === 0 ? (
          <Empty label="No domains match." />
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Disposition</th>
                  <th>Overall</th>
                  <th>Conf.</th>
                  <th>Name</th>
                  <th>SEO</th>
                  <th>Risk</th>
                  <th>DNS</th>
                  <th>HTTP</th>
                  <th>Sources</th>
                  <th>Tags</th>
                  <th>First seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link
                        className="font-medium text-sky-700 hover:underline"
                        href={`/domains/${d.id}`}
                      >
                        {d.unicodeFqdn}
                      </Link>
                      {d.summary && d.summary.shortlistCount > 0 && (
                        <span className="ml-1 text-xs text-amber-600">★</span>
                      )}
                    </td>
                    <td>
                      <Badge value={d.summary?.latestRunStatus} />
                    </td>
                    <td>
                      <Badge value={d.summary?.disposition} />
                      {d.summary?.manualDisposition && (
                        <div className="mt-0.5 text-[11px] text-neutral-500">
                          manual: {d.summary.manualDisposition}
                        </div>
                      )}
                    </td>
                    <td>
                      <ScoreBar value={d.summary?.overallScore} />
                    </td>
                    <td>{fmtScore(d.summary?.confidenceScore)}</td>
                    <td>{fmtScore(d.summary?.nameScore)}</td>
                    <td>{fmtScore(d.summary?.seoScore)}</td>
                    <td>
                      <ScoreBar value={d.summary?.riskScore} invert />
                    </td>
                    <td>
                      {d.summary?.dnsResolves === null || d.summary?.dnsResolves === undefined
                        ? "—"
                        : d.summary.dnsResolves
                          ? "yes"
                          : "no"}
                    </td>
                    <td>{d.summary?.httpStatus ?? "—"}</td>
                    <td className="text-xs text-neutral-500">{d.summary?.sourceKeys.join(", ")}</td>
                    <td className="text-xs text-neutral-500">{d.summary?.tagKeys.join(", ")}</td>
                    <td className="text-xs text-neutral-500">{fmtDate(d.firstSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.hasNextPage && (
          <div className="mt-3 text-center">
            <Button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
