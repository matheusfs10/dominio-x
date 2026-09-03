export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function fmtScore(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : Math.round(value).toString();
}

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

export function fmtPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

export function fmtBool(value: boolean | null | undefined, yes = "sim", no = "não"): string {
  return value === null || value === undefined ? "—" : value ? yes : no;
}

export function scoreTone(value: number | null | undefined, invert = false): string {
  if (value === null || value === undefined) return "bg-neutral-200 text-neutral-600";
  const v = invert ? 100 - value : value;
  if (v >= 70) return "bg-emerald-100 text-emerald-800";
  if (v >= 40) return "bg-amber-100 text-amber-800";
  return "bg-rose-100 text-rose-800";
}

export const STATUS_TONE: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700",
  running: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-neutral-200 text-neutral-600",
  skipped: "bg-neutral-100 text-neutral-500",
  pending: "bg-neutral-200 text-neutral-700",
  accepted: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  quarantined: "bg-orange-100 text-orange-800",
  needs_review: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-800",
  draft: "bg-sky-100 text-sky-800",
  archived: "bg-neutral-200 text-neutral-600",
  ready: "bg-emerald-100 text-emerald-800",
  disabled: "bg-neutral-200 text-neutral-600",
  decision_pending: "bg-amber-100 text-amber-800",
  not_configured: "bg-rose-100 text-rose-800",
  ingesting: "bg-sky-100 text-sky-800",
  ingested: "bg-emerald-100 text-emerald-800",
  analyzing: "bg-sky-100 text-sky-800",
  open: "bg-emerald-100 text-emerald-800",
  closed: "bg-neutral-200 text-neutral-700",
};

/**
 * Rótulos em pt-BR para valores enumerados vindos da API. Identificadores técnicos
 * (chaves de métricas, regras, provedores, códigos de erro) são exibidos como estão.
 */
export const LABELS: Record<string, string> = {
  // status de análise / etapas
  queued: "na fila",
  running: "em execução",
  completed: "concluída",
  partial: "parcial",
  failed: "falhou",
  cancelled: "cancelada",
  skipped: "pulada",
  pending: "pendente",
  // disposição automática
  accepted: "aceito",
  rejected: "rejeitado",
  quarantined: "em quarentena",
  needs_review: "revisar",
  // disposição manual
  interesting: "interessante",
  monitoring: "monitorando",
  acquisition_target: "alvo de aquisição",
  acquired: "adquirido",
  // rulesets / modelos / shortlists
  active: "ativo",
  draft: "rascunho",
  archived: "arquivado",
  open: "aberta",
  closed: "fechada",
  // provedores
  ready: "pronto",
  disabled: "desativado",
  decision_pending: "decisão pendente",
  not_configured: "não configurado",
  // batches
  ingesting: "ingerindo",
  ingested: "ingerido",
  analyzing: "analisando",
  // estados de observação
  measured: "medido",
  unknown: "desconhecido",
  not_available: "indisponível",
  error: "erro",
  // gatilhos
  manual: "manual",
  batch: "lote",
  csv_import: "importação CSV",
  reanalysis: "reanálise",
  retry: "nova tentativa",
  smoke: "smoke test",
  // fontes
  registro_br_release: "Registro.br (liberação)",
  // papéis
  admin: "administrador",
  analyst: "analista",
  viewer: "leitor",
  // crawler jobs
  claimed: "reservado",
  expired: "expirado",
  // etapas do pipeline
  preflight: "pré-checagem",
  dns: "DNS",
  crawl: "crawler",
  candidate_gate: "gate de candidatos",
  seo: "SEO",
  rules: "regras",
  score: "pontuação",
  complete: "conclusão",
  // decisão de candidato
  allow: "permitido",
  deny: "negado",
};

export function label(value: string | null | undefined): string {
  if (!value) return "—";
  return LABELS[value] ?? value.replace(/_/g, " ");
}
