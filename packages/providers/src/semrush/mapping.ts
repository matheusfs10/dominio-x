import { METRICS } from "@dominio-x/contracts";

/**
 * Generic metric keys this provider is allowed to populate. The vendor field → metric key map
 * is filled in when the integration mode is decided. Only fields the selected endpoint really
 * returns may be mapped; never fabricate metrics.
 */
export const SEMRUSH_METRIC_KEYS = [
  METRICS.SEO_ORGANIC_KEYWORDS,
  METRICS.SEO_ESTIMATED_ORGANIC_TRAFFIC,
  METRICS.SEO_PAID_KEYWORDS,
  METRICS.SEO_ESTIMATED_PAID_TRAFFIC,
  METRICS.SEO_AUTHORITY,
  METRICS.LINKS_REFERRING_DOMAINS,
  METRICS.LINKS_BACKLINKS,
] as const;

/** Vendor field name → generic metric key. Empty while in standby. */
export const SEMRUSH_FIELD_MAP: Readonly<Record<string, (typeof SEMRUSH_METRIC_KEYS)[number]>> = {};
