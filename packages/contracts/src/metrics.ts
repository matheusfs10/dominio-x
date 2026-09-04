/**
 * Generic metric keys. Providers map their vendor-specific fields onto these keys.
 * Nothing outside a provider adapter may know vendor field names.
 */
export const METRICS = {
  // Local lexical provider (zero cost)
  LEXICAL_FQDN_LENGTH: "lexical.fqdn_length",
  LEXICAL_SLD_LENGTH: "lexical.sld_length",
  LEXICAL_LABEL_COUNT: "lexical.label_count",
  LEXICAL_DIGIT_COUNT: "lexical.digit_count",
  LEXICAL_HYPHEN_COUNT: "lexical.hyphen_count",
  LEXICAL_REPEATED_CHAR_MAX_RUN: "lexical.repeated_char_max_run",
  LEXICAL_ALPHA_RATIO: "lexical.alpha_ratio",
  LEXICAL_VOWEL_RATIO: "lexical.vowel_ratio",
  LEXICAL_IS_PUNYCODE: "lexical.is_punycode",
  LEXICAL_TOKENS: "lexical.tokens",
  LEXICAL_RANDOMNESS_SCORE: "lexical.randomness_score",
  LEXICAL_TLD: "lexical.tld",
  LEXICAL_IS_BR: "lexical.is_br",
  LEXICAL_IS_COM_BR: "lexical.is_com_br",
  LEXICAL_HAS_DICTIONARY_TOKEN: "lexical.has_dictionary_token",

  // DNS provider
  DNS_RESOLVES: "dns.resolves",
  DNS_A_COUNT: "dns.a_count",
  DNS_AAAA_COUNT: "dns.aaaa_count",
  DNS_MX_COUNT: "dns.mx_count",
  DNS_NS_COUNT: "dns.ns_count",
  DNS_TXT_COUNT: "dns.txt_count",
  DNS_CNAME: "dns.cname",
  DNS_A_RECORDS: "dns.a_records",
  DNS_NS_RECORDS: "dns.ns_records",
  DNS_MX_RECORDS: "dns.mx_records",
  DNS_HAS_SPF: "dns.has_spf",

  // HTTP crawler (isolated project)
  HTTP_REACHABLE: "http.reachable",
  HTTP_STATUS: "http.status",
  HTTP_HTTPS_AVAILABLE: "http.https_available",
  HTTP_REDIRECT_COUNT: "http.redirect_count",
  HTTP_REDIRECT_CHAIN: "http.redirect_chain",
  HTTP_FINAL_URL: "http.final_url",
  HTTP_FINAL_HOSTNAME: "http.final_hostname",
  HTTP_TITLE: "http.title",
  HTTP_META_DESCRIPTION: "http.meta_description",
  HTTP_CONTENT_TYPE: "http.content_type",
  HTTP_CONTENT_LENGTH: "http.content_length",
  HTTP_SERVER: "http.server",
  HTTP_SECURITY_BLOCKED: "http.security_blocked",
  HTTP_ERROR: "http.error",

  // RDAP provider
  RDAP_AVAILABLE: "rdap.available",
  RDAP_STATUS: "rdap.status",
  RDAP_REGISTRATION_DATE: "rdap.registration_date",
  RDAP_EXPIRATION_DATE: "rdap.expiration_date",
  RDAP_LAST_CHANGED_DATE: "rdap.last_changed_date",
  RDAP_NAMESERVER_COUNT: "rdap.nameserver_count",

  // SEO / links (paid providers, e.g. Semrush)
  SEO_ORGANIC_KEYWORDS: "seo.organic_keywords",
  SEO_ESTIMATED_ORGANIC_TRAFFIC: "seo.estimated_organic_traffic",
  SEO_PAID_KEYWORDS: "seo.paid_keywords",
  SEO_ESTIMATED_PAID_TRAFFIC: "seo.estimated_paid_traffic",
  SEO_AUTHORITY: "seo.authority",
  LINKS_REFERRING_DOMAINS: "links.referring_domains",
  LINKS_BACKLINKS: "links.backlinks",

  // Estimated search traffic for one location over a rolling window (paid providers, e.g. DataForSEO).
  // These are *estimates derived from SERP position x search volume*, not analytics visits.
  TRAFFIC_WINDOW_MONTHS: "traffic.window_months",
  TRAFFIC_WINDOW_FROM: "traffic.window_from",
  TRAFFIC_WINDOW_TO: "traffic.window_to",
  TRAFFIC_LOCATION_CODE: "traffic.location_code",
  TRAFFIC_LOCATION_NAME: "traffic.location_name",
  TRAFFIC_HAS_DATA: "traffic.has_data",
  TRAFFIC_VISITS_TOTAL: "traffic.visits_total",
  TRAFFIC_VISITS_MONTHLY_AVG: "traffic.visits_monthly_avg",
  TRAFFIC_VISITS_LAST_MONTH: "traffic.visits_last_month",
  TRAFFIC_VISITS_PEAK_MONTH: "traffic.visits_peak_month",
  TRAFFIC_MONTHS_WITH_TRAFFIC: "traffic.months_with_traffic",
  TRAFFIC_TREND_RATIO: "traffic.trend_ratio",
  TRAFFIC_PAID_VISITS_TOTAL: "traffic.paid_visits_total",
  TRAFFIC_SERP_COUNT_LAST_MONTH: "traffic.serp_count_last_month",
  TRAFFIC_MONTHLY_SERIES: "traffic.monthly_series",
} as const;

export type MetricKey = (typeof METRICS)[keyof typeof METRICS];

export const METRIC_KEYS: readonly MetricKey[] = Object.values(METRICS);

/** Metrics that come from paid / provider-restricted sources. */
export const PAID_METRIC_PREFIXES = ["seo.", "links.", "traffic."] as const;

export const SEO_METRIC_KEYS: readonly MetricKey[] = [
  METRICS.SEO_ORGANIC_KEYWORDS,
  METRICS.SEO_ESTIMATED_ORGANIC_TRAFFIC,
  METRICS.SEO_PAID_KEYWORDS,
  METRICS.SEO_ESTIMATED_PAID_TRAFFIC,
  METRICS.SEO_AUTHORITY,
  METRICS.LINKS_REFERRING_DOMAINS,
  METRICS.LINKS_BACKLINKS,
];

/**
 * Location-scoped traffic metrics. `traffic.*` values only describe the location recorded in
 * `traffic.location_code`; comparing them across locations is meaningless.
 */
export const TRAFFIC_METRIC_KEYS: readonly MetricKey[] = [
  METRICS.TRAFFIC_WINDOW_MONTHS,
  METRICS.TRAFFIC_WINDOW_FROM,
  METRICS.TRAFFIC_WINDOW_TO,
  METRICS.TRAFFIC_LOCATION_CODE,
  METRICS.TRAFFIC_LOCATION_NAME,
  METRICS.TRAFFIC_HAS_DATA,
  METRICS.TRAFFIC_VISITS_TOTAL,
  METRICS.TRAFFIC_VISITS_MONTHLY_AVG,
  METRICS.TRAFFIC_VISITS_LAST_MONTH,
  METRICS.TRAFFIC_VISITS_PEAK_MONTH,
  METRICS.TRAFFIC_MONTHS_WITH_TRAFFIC,
  METRICS.TRAFFIC_TREND_RATIO,
  METRICS.TRAFFIC_PAID_VISITS_TOTAL,
  METRICS.TRAFFIC_SERP_COUNT_LAST_MONTH,
  METRICS.TRAFFIC_MONTHLY_SERIES,
];
