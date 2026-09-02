import { domainToASCII, domainToUnicode } from "node:url";
import { isIP } from "node:net";
import { parse as parseTld } from "tldts";
import { NORMALIZATION_VERSION } from "@dominio-x/contracts";

export { NORMALIZATION_VERSION };

export const MAX_FQDN_LENGTH = 253;
export const MAX_LABEL_LENGTH = 63;

export type NormalizationErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "LABEL_TOO_LONG"
  | "IP_ADDRESS"
  | "LOCALHOST"
  | "INVALID_CHARACTERS"
  | "INVALID_LABEL"
  | "NO_TLD"
  | "UNKNOWN_TLD"
  | "NOT_REGISTRABLE"
  | "IDN_CONVERSION_FAILED";

export interface NormalizedDomain {
  ok: true;
  /** Original input as received (trimmed). */
  input: string;
  /** Hostname extracted from input (before validation), lowercase. */
  extractedHostname: string;
  /** Canonical lowercase ASCII (punycode) FQDN without trailing dot. */
  asciiFqdn: string;
  /** Unicode representation (equal to asciiFqdn when no IDN labels). */
  unicodeFqdn: string;
  /** Registrable domain (eTLD+1), e.g. example.com.br. */
  registrableDomain: string;
  /** Second-level label of the registrable domain, e.g. "example". */
  sld: string;
  /** Public suffix, e.g. "com.br". */
  tld: string;
  /** Whether the input hostname is a subdomain of the registrable domain. */
  isSubdomain: boolean;
  isIdn: boolean;
  labels: string[];
  normalizationVersion: number;
}

export interface NormalizationFailure {
  ok: false;
  input: string;
  extractedHostname: string | null;
  code: NormalizationErrorCode;
  message: string;
  normalizationVersion: number;
}

export type NormalizationResult = NormalizedDomain | NormalizationFailure;

const LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Extraction step: pull a hostname out of loosely formatted input (URLs, paths, ports,
 * surrounding whitespace). This is deliberately separate from validation.
 */
export function extractHostname(rawInput: string): string | null {
  let value = rawInput.trim();
  if (value.length === 0) return null;

  // Strip scheme if present.
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
  if (schemeMatch) value = value.slice(schemeMatch[0].length);

  // Strip credentials, path, query, fragment.
  const at = value.indexOf("@");
  const firstSlash = value.search(/[/?#]/);
  if (at !== -1 && (firstSlash === -1 || at < firstSlash)) value = value.slice(at + 1);
  const cut = value.search(/[/?#\s]/);
  if (cut !== -1) value = value.slice(0, cut);

  // Strip port (but not IPv6 brackets — those are rejected later anyway).
  if (!value.startsWith("[")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon !== -1 && /^\d{1,5}$/.test(value.slice(lastColon + 1)))
      value = value.slice(0, lastColon);
  }

  // Normalize trailing dot and case.
  value = value.replace(/\.+$/, "").toLowerCase();
  if (value.length === 0) return null;
  return value;
}

function failure(
  input: string,
  extractedHostname: string | null,
  code: NormalizationErrorCode,
  message: string,
): NormalizationFailure {
  return {
    ok: false,
    input,
    extractedHostname,
    code,
    message,
    normalizationVersion: NORMALIZATION_VERSION,
  };
}

/**
 * Deterministic normalization + validation of a domain name.
 * All ingestion paths must use this function.
 */
export function normalizeDomain(rawInput: string): NormalizationResult {
  const input = typeof rawInput === "string" ? rawInput.trim() : "";
  if (input.length === 0) return failure(input, null, "EMPTY", "Domain is empty.");

  const extracted = extractHostname(input);
  if (!extracted) return failure(input, null, "EMPTY", "Could not extract a hostname.");

  if (extracted.startsWith("[") || isIP(extracted) !== 0) {
    return failure(input, extracted, "IP_ADDRESS", "IP addresses are not domains.");
  }
  if (
    extracted === "localhost" ||
    extracted.endsWith(".localhost") ||
    extracted.endsWith(".local")
  ) {
    return failure(input, extracted, "LOCALHOST", "Local hostnames are not allowed.");
  }
  if (/[\s\\/:@#?]/.test(extracted) || /[<>"'`{}|^~[\]]/.test(extracted)) {
    return failure(input, extracted, "INVALID_CHARACTERS", "Hostname contains invalid characters.");
  }

  // IDN → ASCII (punycode). Node applies UTS#46 processing (case folding, NFC).
  const ascii = domainToASCII(extracted);
  if (!ascii)
    return failure(
      input,
      extracted,
      "IDN_CONVERSION_FAILED",
      "Hostname could not be converted to ASCII.",
    );

  const asciiFqdn = ascii.replace(/\.+$/, "").toLowerCase();
  if (asciiFqdn.length > MAX_FQDN_LENGTH)
    return failure(input, extracted, "TOO_LONG", "Hostname exceeds 253 characters.");

  const labels = asciiFqdn.split(".");
  if (labels.length < 2)
    return failure(input, extracted, "NO_TLD", "Hostname has no top-level domain.");
  for (const label of labels) {
    if (label.length === 0)
      return failure(input, extracted, "INVALID_LABEL", "Hostname contains an empty label.");
    if (label.length > MAX_LABEL_LENGTH)
      return failure(input, extracted, "LABEL_TOO_LONG", "A label exceeds 63 characters.");
    if (!LABEL_REGEX.test(label))
      return failure(input, extracted, "INVALID_LABEL", `Invalid label "${label}".`);
  }
  const lastLabel = labels[labels.length - 1]!;
  if (/^\d+$/.test(lastLabel))
    return failure(input, extracted, "IP_ADDRESS", "Numeric TLDs are not valid.");

  const parsed = parseTld(asciiFqdn, { allowPrivateDomains: false, detectIp: true });
  if (parsed.isIp) return failure(input, extracted, "IP_ADDRESS", "IP addresses are not domains.");
  if (!parsed.publicSuffix || !parsed.isIcann) {
    return failure(
      input,
      extracted,
      "UNKNOWN_TLD",
      "Top-level domain is not on the public suffix list.",
    );
  }
  if (!parsed.domain)
    return failure(
      input,
      extracted,
      "NOT_REGISTRABLE",
      "Hostname is a public suffix, not a registrable domain.",
    );

  const registrableDomain = parsed.domain.toLowerCase();
  const tld = parsed.publicSuffix.toLowerCase();
  const sld = registrableDomain.slice(0, registrableDomain.length - tld.length - 1);
  const unicodeFqdn = domainToUnicode(asciiFqdn) || asciiFqdn;
  const isIdn = labels.some((l) => l.startsWith("xn--"));

  return {
    ok: true,
    input,
    extractedHostname: extracted,
    asciiFqdn,
    unicodeFqdn,
    registrableDomain,
    sld,
    tld,
    isSubdomain: asciiFqdn !== registrableDomain,
    isIdn,
    labels,
    normalizationVersion: NORMALIZATION_VERSION,
  };
}

export function isValidDomain(rawInput: string): boolean {
  return normalizeDomain(rawInput).ok;
}
