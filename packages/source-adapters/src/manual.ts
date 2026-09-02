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

/** Manual single/multi domain submission by an analyst. */
export class ManualSourceAdapter implements SourceAdapter {
  readonly key = SOURCE_KEYS.MANUAL;
  private stats: ParseStats | null = null;

  probe(): Promise<SourceProbeResult> {
    return Promise.resolve({ unchanged: false });
  }
  fetch(): Promise<SourceArtifact> {
    return Promise.reject(new Error("Manual adapter does not fetch; use artifactFromDomains()"));
  }

  artifactFromDomains(domains: string[], metadata: Record<string, unknown> = {}): SourceArtifact {
    const content = Buffer.from(domains.join("\n") + "\n", "utf8");
    return {
      sourceKey: this.key,
      content,
      contentType: "text/plain",
      sha256: sha256Hex(content),
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
    return parseLines(artifact.content.toString("utf8"), stats);
  }

  lastParseStats(): ParseStats | null {
    return this.stats;
  }
}
