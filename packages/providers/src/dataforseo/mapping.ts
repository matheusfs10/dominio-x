import { METRICS } from "@dominio-x/contracts";
import { measuredObservation, unknownObservation, type ObservationInput } from "../types.js";
import type { TargetTraffic, TrafficMonth } from "./client.js";

/**
 * Vendor response -> generic metric keys. Nothing outside this directory sees a DataForSEO
 * field name. Only values the endpoint really returns are mapped; absent data becomes an
 * explicit `not_available` / `unknown` observation, never a zero.
 */

export interface TrafficWindow {
  /** Number of whole calendar months in the window. */
  months: number;
  /** Inclusive `YYYY-MM-DD`. */
  from: string;
  /** Inclusive `YYYY-MM-DD`. */
  to: string;
  locationCode: number;
  locationName: string;
}

/**
 * Last `months` complete calendar months, ending with the previous month. The running month is
 * excluded on purpose: a partial month would read as a traffic collapse in the trend.
 */
export function trafficWindow(
  months: number,
  location: { code: number; name: string },
  now = new Date(),
): TrafficWindow {
  const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const end = new Date(endExclusive.getTime() - 24 * 3600 * 1000);
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  return {
    months,
    from: iso(start),
    to: iso(end),
    locationCode: location.code,
    locationName: location.name,
  };
}

/** Keeps only the months that fall inside the window, oldest first. */
export function monthsInWindow(months: TrafficMonth[], window: TrafficWindow): TrafficMonth[] {
  const from = window.from.slice(0, 7);
  const to = window.to.slice(0, 7);
  return months
    .filter((m) => m.month >= from && m.month <= to)
    .sort((a, b) => a.month.localeCompare(b.month));
}

const PROVIDER_LICENSE = "provider_restricted" as const;

export interface MapTrafficOptions {
  window: TrafficWindow;
  ttlHours: number;
  /** Storage key of the raw response kept as evidence, when one was written. */
  rawEvidenceKey?: string;
}

/**
 * Builds the observation set for one target. `traffic` is `null` when the provider returned no
 * row at all for the target, which is *not* the same as "no traffic".
 */
export function mapTrafficObservations(
  traffic: TargetTraffic | null,
  options: MapTrafficOptions,
): ObservationInput[] {
  const { window, ttlHours, rawEvidenceKey } = options;
  const common = { licenseClass: PROVIDER_LICENSE, ttlHours, rawEvidenceKey };
  // Window/location descriptors are our own request parameters, not provider data.
  const descriptors: ObservationInput[] = [
    measuredObservation(METRICS.TRAFFIC_WINDOW_MONTHS, window.months, {
      licenseClass: "internal",
      ttlHours,
    }),
    measuredObservation(METRICS.TRAFFIC_WINDOW_FROM, window.from, {
      licenseClass: "internal",
      ttlHours,
    }),
    measuredObservation(METRICS.TRAFFIC_WINDOW_TO, window.to, {
      licenseClass: "internal",
      ttlHours,
    }),
    measuredObservation(METRICS.TRAFFIC_LOCATION_CODE, window.locationCode, {
      licenseClass: "internal",
      ttlHours,
    }),
    measuredObservation(METRICS.TRAFFIC_LOCATION_NAME, window.locationName, {
      licenseClass: "internal",
      ttlHours,
    }),
  ];

  const valueKeys = [
    METRICS.TRAFFIC_VISITS_TOTAL,
    METRICS.TRAFFIC_VISITS_MONTHLY_AVG,
    METRICS.TRAFFIC_VISITS_LAST_MONTH,
    METRICS.TRAFFIC_VISITS_PEAK_MONTH,
    METRICS.TRAFFIC_MONTHS_WITH_TRAFFIC,
    METRICS.TRAFFIC_TREND_RATIO,
    METRICS.TRAFFIC_PAID_VISITS_TOTAL,
    METRICS.TRAFFIC_SERP_COUNT_LAST_MONTH,
    METRICS.TRAFFIC_MONTHLY_SERIES,
  ] as const;

  if (!traffic) {
    return [
      ...descriptors,
      ...valueKeys.map((k) =>
        unknownObservation(k, "unknown", "provider returned no row for this target", {
          licenseClass: PROVIDER_LICENSE,
          ttlHours,
        }),
      ),
      measuredObservation(METRICS.TRAFFIC_HAS_DATA, false, common),
    ];
  }

  const months = monthsInWindow(traffic.months, window);
  if (months.length === 0) {
    return [
      ...descriptors,
      ...valueKeys.map((k) =>
        unknownObservation(k, "not_available", "no monthly rows inside the window", {
          licenseClass: PROVIDER_LICENSE,
          ttlHours,
        }),
      ),
      measuredObservation(METRICS.TRAFFIC_HAS_DATA, false, common),
    ];
  }

  const organic = months.map((m) => m.organicVisits);
  const total = sum(organic);
  const last = months[months.length - 1]!;
  const half = Math.floor(months.length / 2);
  const older = sum(organic.slice(0, half));
  const recent = sum(organic.slice(months.length - half));

  const observations: ObservationInput[] = [
    ...descriptors,
    measuredObservation(METRICS.TRAFFIC_HAS_DATA, true, common),
    measuredObservation(METRICS.TRAFFIC_VISITS_TOTAL, total, common),
    measuredObservation(
      METRICS.TRAFFIC_VISITS_MONTHLY_AVG,
      round(total / window.months, 2),
      common,
    ),
    measuredObservation(METRICS.TRAFFIC_VISITS_LAST_MONTH, last.organicVisits, common),
    measuredObservation(METRICS.TRAFFIC_VISITS_PEAK_MONTH, Math.max(...organic), common),
    measuredObservation(
      METRICS.TRAFFIC_MONTHS_WITH_TRAFFIC,
      organic.filter((v) => v > 0).length,
      common,
    ),
    measuredObservation(
      METRICS.TRAFFIC_PAID_VISITS_TOTAL,
      sum(months.map((m) => m.paidVisits)),
      common,
    ),
    measuredObservation(METRICS.TRAFFIC_SERP_COUNT_LAST_MONTH, last.serpCount, common),
    measuredObservation(
      METRICS.TRAFFIC_MONTHLY_SERIES,
      months.map((m) => ({
        month: m.month,
        visits: m.organicVisits,
        paidVisits: m.paidVisits,
        serpCount: m.serpCount,
      })),
      { ...common, valueType: "json" },
    ),
  ];

  // A ratio against a zero baseline is undefined, not "infinite growth".
  observations.push(
    half > 0 && older > 0
      ? measuredObservation(METRICS.TRAFFIC_TREND_RATIO, round(recent / older, 3), common)
      : unknownObservation(
          METRICS.TRAFFIC_TREND_RATIO,
          "not_available",
          half === 0
            ? "window too short to compare halves"
            : "no traffic in the first half of the window",
          { licenseClass: PROVIDER_LICENSE, ttlHours },
        ),
  );
  return observations;
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
const round = (value: number, digits: number): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;
