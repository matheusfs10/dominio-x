import type { CrawlerJob, CrawlerResult } from "@dominio-x/contracts";

/** Thin HTTPS client for the Core machine API. The token is only ever sent as a header. */
export class CoreClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly workerId: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private async call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-machine-token": this.token,
        "user-agent": `dominio-x-crawler/${this.workerId}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CoreApiError(res.status, `${path} → HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  claim(max: number): Promise<{ jobs: CrawlerJob[]; leaseSeconds: number }> {
    return this.call("/v1/internal/crawler/jobs/claim", { workerId: this.workerId, max });
  }
  heartbeat(jobId: string): Promise<{ leaseExpiresAt: string }> {
    return this.call(`/v1/internal/crawler/jobs/${jobId}/heartbeat`, { workerId: this.workerId });
  }
  complete(jobId: string, result: CrawlerResult): Promise<{ ok: true }> {
    return this.call(`/v1/internal/crawler/jobs/${jobId}/complete`, {
      workerId: this.workerId,
      result,
    });
  }
  fail(
    jobId: string,
    errorCode: string,
    message: string,
    retryable: boolean,
  ): Promise<{ willRetry: boolean }> {
    return this.call(`/v1/internal/crawler/jobs/${jobId}/fail`, {
      workerId: this.workerId,
      errorCode,
      message: message.slice(0, 500),
      retryable,
    });
  }
}

export class CoreApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CoreApiError";
  }
}
