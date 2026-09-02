import { describe, expect, it } from "vitest";
import { CsvSourceAdapter } from "./csv.js";
import { ManualSourceAdapter } from "./manual.js";
import { RegistroBrReleaseSourceAdapter } from "./registro-br.js";
import { sha256Hex } from "./types.js";

const FIXTURE = `# Processo de liberação no período de 2026-08-12T15:00:00-03:00 a 2026-08-19T15:00:00-03:00
# Mais informações em https://registro.br/dominio/processo-de-liberacao/
# Arquivo gerado em 2026-08-10T10:00:08-03:00
008bank.com.br
00h.com.br

013digital.com.br
NOT A DOMAIN !!
008bank.com.br
zzzz.app.br
# Fim do arquivo
`;

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

function mockFetch(
  responses: Array<{ status: number; body?: string; headers?: Record<string, string> }>,
): typeof fetch {
  let i = 0;
  return () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return Promise.resolve(new Response(r.body ?? "", { status: r.status, headers: r.headers }));
  };
}

describe("RegistroBrReleaseSourceAdapter", () => {
  it("parses the release list tolerantly and records statistics", async () => {
    const adapter = new RegistroBrReleaseSourceAdapter();
    const artifact = {
      sourceKey: adapter.key,
      content: Buffer.from(FIXTURE),
      contentType: "text/plain",
      sha256: sha256Hex(FIXTURE),
      fetchedAt: new Date(),
      notModified: false,
      etag: null,
      lastModified: null,
      httpStatus: 200,
      url: null,
      metadata: {},
    };
    const records = await collect(adapter.parse(artifact));
    expect(records.map((r) => r.raw)).toEqual([
      "008bank.com.br",
      "00h.com.br",
      "013digital.com.br",
      "zzzz.app.br",
    ]);
    expect(records[0]).toMatchObject({ position: 0, line: 4 });
    const stats = adapter.lastParseStats()!;
    expect(stats.commentLines).toBe(4);
    expect(stats.blankLines).toBe(1);
    expect(stats.invalidLines).toBe(1);
    expect(stats.duplicateLines).toBe(1);
    expect(stats.candidateLines).toBe(6);
    expect(stats.issues[0]).toMatchObject({ line: 8 });
    expect(stats.metadata).toMatchObject({
      releasePeriodStart: "2026-08-12T15:00:00-03:00",
      releasePeriodEnd: "2026-08-19T15:00:00-03:00",
      generatedAt: "2026-08-10T10:00:08-03:00",
      trailerSeen: true,
    });
  });

  it("fetches with conditional headers, computes sha256 and handles 304", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl: typeof fetch = (_url, init) => {
      calls.push(init ?? {});
      if (calls.length === 1)
        return Promise.resolve(
          new Response(FIXTURE, {
            status: 200,
            headers: {
              etag: '"abc"',
              "last-modified": "Mon, 10 Aug 2026 13:00:09 GMT",
              "content-type": "text/plain",
            },
          }),
        );
      return Promise.resolve(new Response(null, { status: 304, headers: { etag: '"abc"' } }));
    };
    const adapter = new RegistroBrReleaseSourceAdapter({ fetchImpl, userAgent: "Test-UA" });
    const first = await adapter.fetch({});
    expect(first.sha256).toBe(sha256Hex(FIXTURE));
    expect(first.etag).toBe('"abc"');
    expect((calls[0]!.headers as Record<string, string>)["user-agent"]).toBe("Test-UA");
    const second = await adapter.fetch({ lastEtag: first.etag, lastModified: first.lastModified });
    expect(second.notModified).toBe(true);
    expect((calls[1]!.headers as Record<string, string>)["if-none-match"]).toBe('"abc"');
  });

  it("retries transient failures only", async () => {
    const ok = new RegistroBrReleaseSourceAdapter({
      fetchImpl: mockFetch([{ status: 503 }, { status: 200, body: FIXTURE }]),
      retries: 1,
    });
    expect((await ok.fetch({})).httpStatus).toBe(200);
    const bad = new RegistroBrReleaseSourceAdapter({
      fetchImpl: mockFetch([{ status: 403 }, { status: 200, body: FIXTURE }]),
      retries: 2,
    });
    await expect(bad.fetch({})).rejects.toThrow(/403/);
  });

  it("rejects oversized sources", async () => {
    const adapter = new RegistroBrReleaseSourceAdapter({
      fetchImpl: mockFetch([{ status: 200, body: FIXTURE }]),
      maxBytes: 10,
    });
    await expect(adapter.fetch({})).rejects.toThrow(/max size/);
  });
});

describe("CsvSourceAdapter", () => {
  it("accepts one domain per row with optional header and reports row errors", async () => {
    const adapter = new CsvSourceAdapter();
    const artifact = adapter.artifactFromContent(
      'domain,notes\nexemplo.com.br,x\n"cafe.com.br"\ninvalid domain\nEXEMPLO.com.br\n',
    );
    const records = await collect(adapter.parse(artifact));
    expect(records.map((r) => r.raw)).toEqual(["exemplo.com.br", "cafe.com.br"]);
    const stats = adapter.lastParseStats()!;
    expect(stats.invalidLines).toBe(1);
    expect(stats.duplicateLines).toBe(1);
    expect(stats.issues[0]).toMatchObject({ line: 4 });
  });

  it("enforces size and row caps", async () => {
    expect(() =>
      new CsvSourceAdapter({ maxBytes: 5 }).artifactFromContent("exemplo.com.br\n"),
    ).toThrow(/maximum size/);
    const adapter = new CsvSourceAdapter({ maxRows: 1 });
    await expect(
      collect(adapter.parse(adapter.artifactFromContent("a.com.br\nb.com.br\n"))),
    ).rejects.toThrow(/Row limit/);
  });
});

describe("ManualSourceAdapter", () => {
  it("wraps domains into an artifact", async () => {
    const adapter = new ManualSourceAdapter();
    const records = await collect(
      adapter.parse(adapter.artifactFromDomains(["Exemplo.com.br", "https://cafe.com.br/x"])),
    );
    expect(records).toHaveLength(2);
  });
});
