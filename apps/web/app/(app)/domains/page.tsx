"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, qs } from "@/lib/api";
import { fmtBool, fmtDate, fmtNumber, fmtScore, label } from "@/lib/format";
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
    trafficVisitsTotal: number | null;
    hasTrafficData: boolean | null;
    domainRating: number | null;
    referringDomains: number | null;
    hasAuthorityData: boolean | null;
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
  hasTraffic: "",
  minVisits: "",
  hasAuthority: "",
  minDomainRating: "",
  minReferringDomains: "",
  shortlisted: "",
  maxDigits: "",
  maxHyphens: "",
  maxLength: "",
  httpStatus: "",
  tag: "",
  sort: "first_seen_at",
  order: "desc",
};

const SORT_LABELS: Record<string, string> = {
  first_seen_at: "primeira vez visto",
  last_seen_at: "última vez visto",
  ascii_fqdn: "domínio (A–Z)",
  overall_score: "nota geral",
  confidence_score: "confiança",
  name_score: "nota do nome",
  seo_score: "nota de SEO",
  risk_score: "risco",
  traffic_visits: "visitantes estimados",
  domain_rating: "domain rating",
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
        title="Domínios"
        subtitle="Explorador com filtros no servidor. As notas refletem a última análise concluída."
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
                profunda
              </label>
              <Button type="submit" variant="primary" disabled={create.isPending}>
                Analisar
              </Button>
            </form>
          )
        }
      />
      <ErrorBox error={create.error} />
      <Card className="mb-4">
        <form onSubmit={apply} className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2">
            <Label>Busca</Label>
            <Input
              value={draft.q}
              onChange={(e) => set("q", e.target.value)}
              placeholder="domínio contém…"
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
            <Label>Fonte</Label>
            <Select value={draft.sourceKey} onChange={(e) => set("sourceKey", e.target.value)}>
              <option value="">qualquer</option>
              <option value="registro_br_release">{label("registro_br_release")}</option>
              <option value="manual">{label("manual")}</option>
              <option value="csv_import">{label("csv_import")}</option>
            </Select>
          </div>
          <div>
            <Label>Status da análise</Label>
            <Select
              value={draft.analysisStatus}
              onChange={(e) => set("analysisStatus", e.target.value)}
            >
              <option value="">qualquer</option>
              {["queued", "running", "completed", "partial", "failed"].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Disposição</Label>
            <Select value={draft.disposition} onChange={(e) => set("disposition", e.target.value)}>
              <option value="">qualquer</option>
              {["accepted", "needs_review", "quarantined", "rejected"].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Disposição manual</Label>
            <Select
              value={draft.manualDisposition}
              onChange={(e) => set("manualDisposition", e.target.value)}
            >
              <option value="">qualquer</option>
              {["interesting", "rejected", "monitoring", "acquisition_target", "acquired"].map(
                (s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ),
              )}
            </Select>
          </div>
          <div>
            <Label>Nota geral mínima</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.minOverall}
              onChange={(e) => set("minOverall", e.target.value)}
            />
          </div>
          <div>
            <Label>Confiança mínima</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.minConfidence}
              onChange={(e) => set("minConfidence", e.target.value)}
            />
          </div>
          <div>
            <Label>Risco máximo</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.maxRisk}
              onChange={(e) => set("maxRisk", e.target.value)}
            />
          </div>
          <div>
            <Label>Máx. de dígitos</Label>
            <Input
              type="number"
              min={0}
              value={draft.maxDigits}
              onChange={(e) => set("maxDigits", e.target.value)}
            />
          </div>
          <div>
            <Label>Máx. de hífens</Label>
            <Input
              type="number"
              min={0}
              value={draft.maxHyphens}
              onChange={(e) => set("maxHyphens", e.target.value)}
            />
          </div>
          <div>
            <Label>Tamanho máximo</Label>
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
              <option value="">qualquer</option>
              <option value="true">resolve</option>
              <option value="false">não resolve</option>
            </Select>
          </div>
          <div>
            <Label>Dados Semrush</Label>
            <Select value={draft.hasSeo} onChange={(e) => set("hasSeo", e.target.value)}>
              <option value="">qualquer</option>
              <option value="true">presentes</option>
              <option value="false">ausentes</option>
            </Select>
          </div>
          <div>
            <Label>Dados de tráfego</Label>
            <Select value={draft.hasTraffic} onChange={(e) => set("hasTraffic", e.target.value)}>
              <option value="">qualquer</option>
              <option value="true">presentes</option>
              <option value="false">ausentes</option>
            </Select>
          </div>
          <div>
            <Label>Mín. de visitantes no período</Label>
            <Input
              type="number"
              min={0}
              value={draft.minVisits}
              onChange={(e) => set("minVisits", e.target.value)}
            />
          </div>
          <div>
            <Label>Dados de autoridade</Label>
            <Select
              value={draft.hasAuthority}
              onChange={(e) => set("hasAuthority", e.target.value)}
            >
              <option value="">qualquer</option>
              <option value="true">presentes</option>
              <option value="false">ausentes</option>
            </Select>
          </div>
          <div>
            <Label>Domain Rating mínimo</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.minDomainRating}
              onChange={(e) => set("minDomainRating", e.target.value)}
            />
          </div>
          <div>
            <Label>Mín. de domínios de referência</Label>
            <Input
              type="number"
              min={0}
              value={draft.minReferringDomains}
              onChange={(e) => set("minReferringDomains", e.target.value)}
            />
          </div>
          <div>
            <Label>Status HTTP</Label>
            <Input
              type="number"
              value={draft.httpStatus}
              onChange={(e) => set("httpStatus", e.target.value)}
            />
          </div>
          <div>
            <Label>Em shortlist</Label>
            <Select value={draft.shortlisted} onChange={(e) => set("shortlisted", e.target.value)}>
              <option value="">qualquer</option>
              <option value="true">sim</option>
              <option value="false">não</option>
            </Select>
          </div>
          <div>
            <Label>Tag</Label>
            <Input value={draft.tag} onChange={(e) => set("tag", e.target.value)} />
          </div>
          <div>
            <Label>Ordenar por</Label>
            <Select value={draft.sort} onChange={(e) => set("sort", e.target.value)}>
              {Object.entries(SORT_LABELS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Ordem</Label>
            <Select value={draft.order} onChange={(e) => set("order", e.target.value)}>
              <option value="desc">decrescente</option>
              <option value="asc">crescente</option>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="primary">
              Aplicar
            </Button>
            <Button
              type="button"
              onClick={() => {
                setDraft(DEFAULT_FILTERS);
                setFilters(DEFAULT_FILTERS);
              }}
            >
              Limpar
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
          <Empty label="Nenhum domínio corresponde aos filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Domínio</th>
                  <th>Status</th>
                  <th>Disposição</th>
                  <th>Geral</th>
                  <th>Conf.</th>
                  <th>Nome</th>
                  <th>SEO</th>
                  <th>Visitantes</th>
                  <th title="Domain Rating do Ahrefs (0-100, escala logarítmica)">DR</th>
                  <th>Risco</th>
                  <th>DNS</th>
                  <th>HTTP</th>
                  <th>Fontes</th>
                  <th>Tags</th>
                  <th>Visto em</th>
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
                        <span className="ml-1 text-xs text-amber-600" title="em shortlist">
                          ★
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge value={d.summary?.latestRunStatus} />
                    </td>
                    <td>
                      <Badge value={d.summary?.disposition} />
                      {d.summary?.manualDisposition && (
                        <div className="mt-0.5 text-[11px] text-neutral-500">
                          manual: {label(d.summary.manualDisposition)}
                        </div>
                      )}
                    </td>
                    <td>
                      <ScoreBar value={d.summary?.overallScore} />
                    </td>
                    <td>{fmtScore(d.summary?.confidenceScore)}</td>
                    <td>{fmtScore(d.summary?.nameScore)}</td>
                    <td>{fmtScore(d.summary?.seoScore)}</td>
                    <td title="visitantes estimados no período configurado">
                      {fmtNumber(d.summary?.trafficVisitsTotal)}
                    </td>
                    <td
                      title={
                        d.summary?.referringDomains === null ||
                        d.summary?.referringDomains === undefined
                          ? "Domain Rating do Ahrefs (escala logarítmica)"
                          : `${d.summary.referringDomains} domínios de referência`
                      }
                    >
                      {d.summary?.domainRating ?? "—"}
                    </td>
                    <td>
                      <ScoreBar value={d.summary?.riskScore} invert />
                    </td>
                    <td>{fmtBool(d.summary?.dnsResolves)}</td>
                    <td>{d.summary?.httpStatus ?? "—"}</td>
                    <td className="text-xs text-neutral-500">
                      {d.summary?.sourceKeys.map(label).join(", ")}
                    </td>
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
              {query.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
