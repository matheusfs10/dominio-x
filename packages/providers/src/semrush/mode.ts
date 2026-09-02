/**
 * Semrush integration mode.
 *
 * - "standby": no integration decided; provider reports `decision_pending` and never calls out.
 * - "official_api": (future) official Semrush Analytics API v3/v4 through this adapter.
 *
 * Website scraping is deliberately NOT a supported mode of this adapter.
 */
export type SemrushIntegrationMode = "standby" | "official_api";

export const SEMRUSH_INTEGRATION_MODE: SemrushIntegrationMode = "standby";
