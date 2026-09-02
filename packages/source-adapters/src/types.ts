import { createHash } from "node:crypto";

export interface SourceProbeContext {
  /** ETag of the last ingested artifact, if any. */
  lastEtag?: string | null;
  lastModified?: string | null;
  lastSha256?: string | null;
  signal?: AbortSignal;
}

export interface SourceProbeResult {
  /** True when the source reports the content unchanged (e.g. 304). Always verify by SHA after fetch. */
  unchanged: boolean;
  etag?: string | null;
  lastModified?: string | null;
  status?: number;
}

export interface SourceFetchContext {
  lastEtag?: string | null;
  lastModified?: string | null;
  signal?: AbortSignal;
}

export interface SourceArtifact {
  sourceKey: string;
  content: Buffer;
  contentType: string | null;
  sha256: string;
  fetchedAt: Date;
  /** True when the server answered 304 and no new content was returned. */
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
  httpStatus: number | null;
  url: string | null;
  metadata: Record<string, unknown>;
}

export interface RawDomainRecord {
  raw: string;
  position: number;
  line: number;
}

export interface ParseIssue {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseStats {
  totalLines: number;
  candidateLines: number;
  commentLines: number;
  blankLines: number;
  invalidLines: number;
  duplicateLines: number;
  issues: ParseIssue[];
  metadata: Record<string, unknown>;
}

export interface SourceAdapter {
  readonly key: string;
  probe(input: SourceProbeContext): Promise<SourceProbeResult>;
  fetch(input: SourceFetchContext): Promise<SourceArtifact>;
  /** Streams raw domain records; parse statistics are available from `lastParseStats()` afterwards. */
  parse(artifact: SourceArtifact): AsyncIterable<RawDomainRecord>;
  lastParseStats(): ParseStats | null;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function emptyStats(): ParseStats {
  return {
    totalLines: 0,
    candidateLines: 0,
    commentLines: 0,
    blankLines: 0,
    invalidLines: 0,
    duplicateLines: 0,
    issues: [],
    metadata: {},
  };
}

export const MAX_PARSE_ISSUES = 200;
