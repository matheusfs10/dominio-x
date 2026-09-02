import { normalizeDomain } from "@dominio-x/normalization";
import { MAX_PARSE_ISSUES, type ParseStats, type RawDomainRecord } from "./types.js";

/**
 * Tolerant one-domain-per-line parser shared by the Registro.br and CSV adapters.
 * It never "guesses" a domain out of an invalid line: the line is counted and reported.
 */
export interface LineParserOptions {
  /** Called for comment lines (starting with #). */
  onComment?: (line: string, lineNumber: number) => void;
  /** Extract the candidate from a line (e.g. first CSV column). Defaults to the trimmed line. */
  extract?: (line: string) => string;
  /** Skip a header row when it looks like one. */
  detectHeader?: boolean;
  maxRows?: number;
}

export async function* parseLines(
  content: string,
  stats: ParseStats,
  options: LineParserOptions = {},
): AsyncGenerator<RawDomainRecord> {
  const seen = new Set<string>();
  let position = 0;
  let lineNumber = 0;
  let headerChecked = false;
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    lineNumber += 1;
    stats.totalLines += 1;
    const line = rawLine.replace(/^FEFF/, "").trim();
    if (line.length === 0) {
      stats.blankLines += 1;
      continue;
    }
    if (line.startsWith("#") || line.startsWith("//")) {
      stats.commentLines += 1;
      options.onComment?.(line, lineNumber);
      continue;
    }
    const candidate = (options.extract ? options.extract(line) : line)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (options.detectHeader && !headerChecked) {
      headerChecked = true;
      if (/^(domain|dominio|domínio|fqdn|host|hostname|name|nome)$/i.test(candidate)) {
        stats.commentLines += 1;
        continue;
      }
    }
    headerChecked = true;
    stats.candidateLines += 1;
    const normalized = normalizeDomain(candidate);
    if (!normalized.ok) {
      stats.invalidLines += 1;
      if (stats.issues.length < MAX_PARSE_ISSUES)
        stats.issues.push({
          line: lineNumber,
          raw: candidate.slice(0, 200),
          reason: normalized.message,
        });
      continue;
    }
    if (seen.has(normalized.asciiFqdn)) {
      stats.duplicateLines += 1;
      continue;
    }
    seen.add(normalized.asciiFqdn);
    if (options.maxRows !== undefined && position >= options.maxRows) {
      throw new ParseLimitError(`Row limit of ${options.maxRows} exceeded`);
    }
    yield { raw: candidate, position: position++, line: lineNumber };
  }
  // Last line handling: split() produces a trailing empty string for files ending in a newline.
  if (lines[lines.length - 1] === "") {
    stats.totalLines -= 1;
    stats.blankLines -= 1;
  }
}

export class ParseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseLimitError";
  }
}
