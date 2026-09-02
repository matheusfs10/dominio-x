import { SOURCE_KEYS } from "@dominio-x/contracts";
import { parseLines } from "./line-parser.js";
import {
  emptyStats,
  sha256Hex,
  type ParseStats,
  type RawDomainRecord,
  type SourceAdapter,
  type SourceArtifact,
  type SourceProbeResult,
} from "./types.js";

export interface CsvAdapterOptions {
  maxBytes?: number;
  maxRows?: number;
}

/**
 * CSV / plain-text import: one domain per row (first column). Header row optional.
 * Row-level errors are reported through parse stats; nothing is guessed.
 */
export class CsvSourceAdapter implements SourceAdapter {
  readonly key = SOURCE_KEYS.CSV_IMPORT;
  private readonly maxBytes: number;
  private readonly maxRows: number;
  private stats: ParseStats | null = null;

  constructor(options: CsvAdapterOptions = {}) {
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.maxRows = options.maxRows ?? 50_000;
  }

  probe(): Promise<SourceProbeResult> {
    return Promise.resolve({ unchanged: false });
  }

  fetch(): Promise<SourceArtifact> {
    return Promise.reject(new Error("CSV adapter does not fetch; use artifactFromContent()"));
  }

  artifactFromContent(
    content: string | Buffer,
    metadata: Record<string, unknown> = {},
  ): SourceArtifact {
    const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    if (buffer.length > this.maxBytes)
      throw new Error(`Import exceeds maximum size of ${this.maxBytes} bytes`);
    return {
      sourceKey: this.key,
      content: buffer,
      contentType: "text/csv",
      sha256: sha256Hex(buffer),
      fetchedAt: new Date(),
      notModified: false,
      etag: null,
      lastModified: null,
      httpStatus: null,
      url: null,
      metadata,
    };
  }

  parse(artifact: SourceArtifact): AsyncIterable<RawDomainRecord> {
    const stats = emptyStats();
    this.stats = stats;
    return parseLines(artifact.content.toString("utf8"), stats, {
      detectHeader: true,
      maxRows: this.maxRows,
      extract: (line) => {
        const sep = line.includes(";") && !line.includes(",") ? ";" : ",";
        const first = line.split(sep)[0] ?? "";
        return first.trim();
      },
    });
  }

  lastParseStats(): ParseStats | null {
    return this.stats;
  }
}
