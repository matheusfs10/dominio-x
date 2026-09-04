import { METRICS, PROVIDER_KEYS } from "@dominio-x/contracts";
import {
  measuredObservation,
  type EnrichmentProvider,
  type EnrichmentRequest,
  type ProviderResult,
} from "../types.js";
import { DICTIONARY } from "./dictionary.js";

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Digits that content-blocking evasion uses in place of letters ("cass1no", "0nlyfans"). */
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

/**
 * Matching surfaces for rule regexes. Lower-cased and accent-stripped so a rule never has to
 * spell "cassino" and "cassÍno"; separators either removed (so "casa-de-aposta" matches
 * "casadeaposta") or turned into spaces (so `\b` anchors work).
 *
 * Leet mapping is a separate surface on purpose: it rewrites digits, which would destroy the
 * `\d+bet` signature that is the strongest squatting pattern in the Brazilian release lists.
 */
export function normalizeNameSurface(
  label: string,
  options: { leet?: boolean; separators: "remove" | "space" },
): string {
  const base = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const separated =
    options.separators === "space"
      ? base
          .replace(/[-_.]+/g, " ")
          .trim()
          .replace(/\s+/g, " ")
      : base.replace(/[-_.]+/g, "");
  return options.leet ? separated.replace(/[013457]/g, (d) => LEET_MAP[d] ?? d) : separated;
}

/** The registrable label in its unicode form: what a human reads, before punycode. */
export function unicodeSld(domain: { unicodeFqdn: string; sld: string; tld: string }): string {
  const suffix = `.${domain.tld}`;
  if (!domain.unicodeFqdn.endsWith(suffix)) return domain.sld;
  const withoutTld = domain.unicodeFqdn.slice(0, -suffix.length);
  return withoutTld.split(".").pop() || domain.sld;
}

/** Consonant clusters that are unusual in Portuguese/English words (used by the randomness heuristic). */
const RARE_BIGRAMS = new Set([
  "bk",
  "bq",
  "bx",
  "cj",
  "cv",
  "cx",
  "dq",
  "dx",
  "fq",
  "fx",
  "gq",
  "gx",
  "hx",
  "jb",
  "jc",
  "jd",
  "jf",
  "jg",
  "jh",
  "jk",
  "jl",
  "jm",
  "jn",
  "jp",
  "jq",
  "jr",
  "js",
  "jt",
  "jv",
  "jw",
  "jx",
  "jy",
  "jz",
  "kq",
  "kx",
  "kz",
  "lx",
  "mq",
  "mx",
  "pq",
  "px",
  "qb",
  "qc",
  "qd",
  "qf",
  "qg",
  "qh",
  "qj",
  "qk",
  "ql",
  "qm",
  "qn",
  "qp",
  "qq",
  "qr",
  "qs",
  "qt",
  "qv",
  "qw",
  "qx",
  "qy",
  "qz",
  "sx",
  "tq",
  "tx",
  "vb",
  "vc",
  "vd",
  "vf",
  "vg",
  "vh",
  "vj",
  "vk",
  "vm",
  "vn",
  "vp",
  "vq",
  "vt",
  "vw",
  "vx",
  "vz",
  "wq",
  "wx",
  "xj",
  "xk",
  "xq",
  "xz",
  "zx",
  "zq",
  "zj",
]);

export interface LexicalMetrics {
  fqdnLength: number;
  sldLength: number;
  labelCount: number;
  digitCount: number;
  hyphenCount: number;
  repeatedCharMaxRun: number;
  alphaRatio: number;
  vowelRatio: number;
  isPunycode: boolean;
  tokens: string[];
  hasDictionaryToken: boolean;
  randomnessScore: number;
  tld: string;
  isBr: boolean;
  isComBr: boolean;
}

export function tokenize(sld: string): string[] {
  const parts = sld.split(/[-_]/).filter(Boolean);
  const tokens: string[] = [];
  for (const part of parts) {
    const letters = part.replace(/\d+/g, " ").trim();
    for (const chunk of letters.split(/\s+/).filter(Boolean)) {
      tokens.push(...segment(chunk));
    }
  }
  return tokens;
}

/** Greedy longest-match dictionary segmentation. Unmatched remainder is dropped (not guessed). */
function segment(word: string): string[] {
  if (word.length < 3) return DICTIONARY.has(word) ? [word] : [];
  const out: string[] = [];
  let i = 0;
  while (i < word.length) {
    let found = "";
    for (let end = Math.min(word.length, i + 16); end > i + 2; end--) {
      const candidate = word.slice(i, end);
      if (DICTIONARY.has(candidate)) {
        found = candidate;
        break;
      }
    }
    if (found) {
      out.push(found);
      i += found.length;
    } else {
      i += 1;
    }
  }
  return out;
}

export function computeLexicalMetrics(input: {
  asciiFqdn: string;
  sld: string;
  tld: string;
  isIdn: boolean;
}): LexicalMetrics {
  const { asciiFqdn, sld, tld } = input;
  const letters = sld.replace(/[^a-z]/g, "");
  const digitCount = (sld.match(/\d/g) ?? []).length;
  const hyphenCount = (sld.match(/-/g) ?? []).length;
  let maxRun = 0;
  let run = 0;
  let prev = "";
  for (const ch of sld) {
    run = ch === prev ? run + 1 : 1;
    prev = ch;
    maxRun = Math.max(maxRun, run);
  }
  const alphaRatio = sld.length > 0 ? letters.length / sld.length : 0;
  const vowels = [...letters].filter((c) => VOWELS.has(c)).length;
  const vowelRatio = letters.length > 0 ? vowels / letters.length : 0;
  const tokens = input.isIdn ? [] : tokenize(sld);
  const coveredByTokens = tokens.reduce((n, t) => n + t.length, 0) / Math.max(1, letters.length);

  // Randomness heuristic in [0,1]: consonant runs, rare bigrams, vowel imbalance, digit share, low token coverage.
  let maxConsonantRun = 0;
  let cRun = 0;
  let rareBigrams = 0;
  for (let i = 0; i < letters.length; i++) {
    const c = letters[i]!;
    cRun = VOWELS.has(c) ? 0 : cRun + 1;
    maxConsonantRun = Math.max(maxConsonantRun, cRun);
    if (i > 0 && RARE_BIGRAMS.has(letters[i - 1]! + c)) rareBigrams += 1;
  }
  let randomness = 0;
  if (letters.length > 0) {
    randomness += Math.min(1, Math.max(0, maxConsonantRun - 3) / 3) * 0.35;
    randomness += Math.min(1, rareBigrams / Math.max(1, letters.length / 3)) * 0.25;
    randomness += Math.min(1, Math.abs(vowelRatio - 0.42) / 0.42) * 0.2;
    randomness += (1 - Math.min(1, coveredByTokens)) * 0.2;
  }
  randomness += Math.min(0.3, (digitCount / Math.max(1, sld.length)) * 0.6);
  randomness = Math.max(0, Math.min(1, randomness));

  return {
    fqdnLength: asciiFqdn.length,
    sldLength: sld.length,
    labelCount: asciiFqdn.split(".").length,
    digitCount,
    hyphenCount,
    repeatedCharMaxRun: maxRun,
    alphaRatio: Math.round(alphaRatio * 1000) / 1000,
    vowelRatio: Math.round(vowelRatio * 1000) / 1000,
    isPunycode: input.isIdn || asciiFqdn.includes("xn--"),
    tokens,
    hasDictionaryToken: tokens.length > 0,
    randomnessScore: Math.round(randomness * 1000) / 1000,
    tld,
    isBr: tld === "br" || tld.endsWith(".br"),
    isComBr: tld === "com.br",
  };
}

export class LexicalProvider implements EnrichmentProvider {
  readonly key = PROVIDER_KEYS.LEXICAL;
  readonly capabilities = ["lexical"] as const;
  readonly paid = false;

  isConfigured(): boolean {
    return true;
  }
  describeStatus() {
    return { configured: true, state: "ready", detail: "local computation, zero cost" };
  }
  estimate() {
    return Promise.resolve({ units: 0, estimatedCostUsd: 0, cached: false });
  }

  enrich(request: EnrichmentRequest): Promise<ProviderResult> {
    const startedAt = Date.now();
    const m = computeLexicalMetrics(request.domain);
    const label = unicodeSld(request.domain);
    const o = (key: string, value: number | string | boolean | string[]) =>
      measuredObservation(key, value, {
        licenseClass: "internal",
        ttlHours: null,
        metadata: { normalizationVersion: 1 },
      });
    const observations = [
      o(METRICS.LEXICAL_FQDN_LENGTH, m.fqdnLength),
      o(METRICS.LEXICAL_SLD_LENGTH, m.sldLength),
      o(METRICS.LEXICAL_LABEL_COUNT, m.labelCount),
      o(METRICS.LEXICAL_DIGIT_COUNT, m.digitCount),
      o(METRICS.LEXICAL_HYPHEN_COUNT, m.hyphenCount),
      o(METRICS.LEXICAL_REPEATED_CHAR_MAX_RUN, m.repeatedCharMaxRun),
      o(METRICS.LEXICAL_ALPHA_RATIO, m.alphaRatio),
      o(METRICS.LEXICAL_VOWEL_RATIO, m.vowelRatio),
      o(METRICS.LEXICAL_IS_PUNYCODE, m.isPunycode),
      o(METRICS.LEXICAL_TOKENS, m.tokens),
      o(METRICS.LEXICAL_HAS_DICTIONARY_TOKEN, m.hasDictionaryToken),
      o(METRICS.LEXICAL_RANDOMNESS_SCORE, m.randomnessScore),
      o(METRICS.LEXICAL_TLD, m.tld),
      o(METRICS.LEXICAL_IS_BR, m.isBr),
      o(METRICS.LEXICAL_IS_COM_BR, m.isComBr),
      o(METRICS.LEXICAL_SLD_ASCII, normalizeNameSurface(label, { separators: "remove" })),
      o(
        METRICS.LEXICAL_SLD_LEET,
        normalizeNameSurface(label, { separators: "remove", leet: true }),
      ),
      o(METRICS.LEXICAL_SLD_WORDS, normalizeNameSurface(label, { separators: "space" })),
    ];
    return Promise.resolve({
      providerKey: this.key,
      status: "ok",
      observations,
      requests: [],
      durationMs: Date.now() - startedAt,
    });
  }
}
