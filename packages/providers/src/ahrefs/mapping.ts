import { METRICS } from "@dominio-x/contracts";
import { measuredObservation, unknownObservation, type ObservationInput } from "../types.js";
import type { AuthorityLookup } from "./client.js";

/**
 * Vendor response -> generic metric keys. Nothing outside this directory sees an Ahrefs field
 * name. Only values the endpoint really returned are mapped; an absent field becomes an
 * explicit `not_available` observation, never a zero — a domain with no data is not a domain
 * with no backlinks.
 */

const PROVIDER_LICENSE = "provider_restricted" as const;

export interface MapAuthorityOptions {
  ttlHours: number;
  /** Storage key of the raw response kept as evidence, when one was written. */
  rawEvidenceKey?: string;
}

const VALUE_KEYS = [
  METRICS.AUTHORITY_DOMAIN_RATING,
  METRICS.AUTHORITY_BACKLINKS,
  METRICS.AUTHORITY_REFERRING_DOMAINS,
  METRICS.AUTHORITY_DOFOLLOW_BACKLINKS,
  METRICS.AUTHORITY_DOFOLLOW_REFERRING_DOMAINS,
  METRICS.AUTHORITY_DOFOLLOW_RATIO,
] as const;

/**
 * Builds the observation set for one target. `lookup` is `null` when the tool answered but
 * carried no usable row, which is *not* the same as "no authority".
 */
export function mapAuthorityObservations(
  lookup: AuthorityLookup | null,
  options: MapAuthorityOptions,
): ObservationInput[] {
  const { ttlHours, rawEvidenceKey } = options;
  const common = { licenseClass: PROVIDER_LICENSE, ttlHours, rawEvidenceKey };

  if (!lookup) {
    return [
      ...VALUE_KEYS.map((k) =>
        unknownObservation(k, "unknown", "the tool returned no row for this target", {
          licenseClass: PROVIDER_LICENSE,
          ttlHours,
        }),
      ),
      measuredObservation(METRICS.AUTHORITY_HAS_DATA, false, common),
    ];
  }

  // The query parameters are our own, not vendor data, so they are internal evidence.
  const descriptors: ObservationInput[] = [
    measuredObservation(METRICS.AUTHORITY_MODE, lookup.mode, {
      licenseClass: "internal",
      ttlHours,
    }),
    measuredObservation(METRICS.AUTHORITY_TARGET_URL, lookup.target, {
      licenseClass: "internal",
      ttlHours,
    }),
  ];

  const { domainRating, backlinks, referringDomains } = lookup.overview;
  const { dofollowBacklinks, dofollowReferringDomains } = lookup.overview;
  const observations: ObservationInput[] = [...descriptors];

  const add = (key: string, value: number | null, reason: string): void => {
    observations.push(
      value === null
        ? unknownObservation(key, "not_available", reason, {
            licenseClass: PROVIDER_LICENSE,
            ttlHours,
          })
        : measuredObservation(key, value, common),
    );
  };

  add(METRICS.AUTHORITY_DOMAIN_RATING, domainRating, "no domain rating in the response");
  add(METRICS.AUTHORITY_BACKLINKS, backlinks, "no backlink count in the response");
  add(
    METRICS.AUTHORITY_REFERRING_DOMAINS,
    referringDomains,
    "no referring-domain count in the response",
  );
  add(
    METRICS.AUTHORITY_DOFOLLOW_BACKLINKS,
    dofollowBacklinks,
    "no dofollow backlink count in the response",
  );
  add(
    METRICS.AUTHORITY_DOFOLLOW_REFERRING_DOMAINS,
    dofollowReferringDomains,
    "no dofollow referring-domain count in the response",
  );

  // A ratio against a zero baseline is undefined, not "no dofollow links".
  add(
    METRICS.AUTHORITY_DOFOLLOW_RATIO,
    dofollowReferringDomains !== null && referringDomains !== null && referringDomains > 0
      ? round(dofollowReferringDomains / referringDomains, 3)
      : null,
    referringDomains === 0 ? "no referring domains to compare against" : "counts not available",
  );

  // "Has data" is true as soon as the index knows the domain at all, even at DR 0.
  observations.push(measuredObservation(METRICS.AUTHORITY_HAS_DATA, domainRating !== null, common));
  return observations;
}

const round = (value: number, digits: number): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;
