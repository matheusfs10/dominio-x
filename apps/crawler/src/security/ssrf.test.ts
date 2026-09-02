import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyAddress } from "./ip.js";
import {
  SecurityBlockedError,
  FetchLimitError,
  resolveSafeAddress,
  safeFetch,
  validateUrl,
  type SafeFetchOptions,
} from "./safe-fetch.js";

describe("address classification (SSRF matrix)", () => {
  const blocked = [
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.1.1",
    "100.64.0.1",
    "100.100.100.200",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "198.51.100.7",
    "203.0.113.9",
    "198.18.0.1",
    "192.0.0.192",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::0808:0808",
    "2002:0a00:0001::",
    "2001:0000::1",
    "fd00:ec2::254",
    "2001:db8::1",
    "not-an-ip",
  ];
  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "200.160.2.3",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
  ];

  it.each(blocked)("blocks %s", (ip) => {
    expect(classifyAddress(ip).allowed).toBe(false);
  });
  it.each(allowed)("allows %s", (ip) => {
    expect(classifyAddress(ip).allowed).toBe(true);
  });
});

describe("URL validation", () => {
  it("rejects non-http schemes, credentials, odd ports and local names", () => {
    expect(() => validateUrl("ftp://example.com/", {})).toThrow(SecurityBlockedError);
    expect(() => validateUrl("file:///etc/passwd", {})).toThrow(SecurityBlockedError);
    expect(() => validateUrl("http://user:pw@example.com/", {})).toThrow(/credentials/);
    expect(() => validateUrl("http://example.com:8080/", {})).toThrow(/port/);
    expect(() => validateUrl("http://localhost/", {})).toThrow(/hostname/);
    expect(() => validateUrl("http://api.internal/", {})).toThrow(/hostname/);
    expect(validateUrl("https://example.com.br/x", {}).hostname).toBe("example.com.br");
  });

  it("rejects hostnames resolving to any unsafe address", async () => {
    const base: SafeFetchOptions = {
      connectTimeoutMs: 1000,
      totalTimeoutMs: 2000,
      maxRedirects: 3,
      maxBodyBytes: 1024,
      maxDecompressedBytes: 2048,
      userAgent: "t",
    };
    const mixed = {
      ...base,
      lookup: () =>
        Promise.resolve([
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ]),
    };
    await expect(resolveSafeAddress(new URL("http://evil.example/"), mixed)).rejects.toThrow(
      /private/,
    );
    const meta = {
      ...base,
      lookup: () => Promise.resolve([{ address: "169.254.169.254", family: 4 }]),
    };
    await expect(resolveSafeAddress(new URL("http://meta.example/"), meta)).rejects.toThrow(
      /metadata_endpoint/,
    );
    const v6 = {
      ...base,
      lookup: () => Promise.resolve([{ address: "::ffff:127.0.0.1", family: 6 }]),
    };
    await expect(resolveSafeAddress(new URL("http://v6.example/"), v6)).rejects.toThrow(/loopback/);
    const ok = { ...base, lookup: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }]) };
    await expect(resolveSafeAddress(new URL("http://ok.example/"), ok)).resolves.toEqual({
      address: "8.8.8.8",
      family: 4,
    });
  });
});

describe("safeFetch against a local server", () => {
  let server: Server;
  let port: number;
  let options: SafeFetchOptions;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      switch (url.pathname) {
        case "/ok":
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", server: "test" });
          res.end(
            '<html><head><title>Hello &amp; welcome</title><meta name="description" content="A test page"></head><body>x</body></html>',
          );
          return;
        case "/redirect-ok":
          res.writeHead(302, { location: "/ok" });
          res.end();
          return;
        case "/redirect-private":
          res.writeHead(302, { location: "http://10.0.0.1/" });
          res.end();
          return;
        case "/redirect-metadata":
          res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" });
          res.end();
          return;
        case "/redirect-loop":
          res.writeHead(302, { location: "/redirect-loop" });
          res.end();
          return;
        case "/redirect-scheme":
          res.writeHead(302, { location: "file:///etc/passwd" });
          res.end();
          return;
        case "/big":
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(Buffer.alloc(5 * 1024 * 1024, 65));
          return;
        case "/bomb": {
          const gz = gzipSync(Buffer.alloc(3 * 1024 * 1024, 66));
          res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
          res.end(gz);
          return;
        }
        case "/slow":
          setTimeout(() => {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end("late");
          }, 3000);
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;
    options = {
      connectTimeoutMs: 1000,
      totalTimeoutMs: 1500,
      maxRedirects: 3,
      maxBodyBytes: 1024 * 1024,
      maxDecompressedBytes: 2 * 1024 * 1024,
      userAgent: "Dominio-X-Test",
      allowedPorts: [port, 80],
      dangerouslyAllowAddresses: ["127.0.0.1"],
    };
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const local = (path: string) => `http://127.0.0.1:${port}${path}`;

  it("fetches and follows same-host redirects", async () => {
    const r = await safeFetch(local("/redirect-ok"), options);
    expect(r.status).toBe(200);
    expect(r.redirectChain).toHaveLength(1);
    expect(r.body.toString()).toContain("Hello");
    expect(r.headers.server).toBe("test");
  });

  it("blocks redirects from a public-looking target to private, metadata or non-http destinations", async () => {
    await expect(safeFetch(local("/redirect-private"), options)).rejects.toThrow(/blocked:private/);
    await expect(safeFetch(local("/redirect-metadata"), options)).rejects.toThrow(
      /metadata_endpoint/,
    );
    await expect(safeFetch(local("/redirect-scheme"), options)).rejects.toThrow(/blocked:scheme/);
  });

  it("caps redirects, body bytes, decompressed bytes and total time", async () => {
    await expect(safeFetch(local("/redirect-loop"), options)).rejects.toThrow(FetchLimitError);
    const big = await safeFetch(local("/big"), options);
    expect(big.truncated).toBe(true);
    expect(big.body.length).toBeLessThanOrEqual(options.maxBodyBytes);
    const bomb = await safeFetch(local("/bomb"), options);
    expect(bomb.truncated).toBe(true);
    expect(bomb.body.length).toBeLessThanOrEqual(options.maxDecompressedBytes);
    await expect(safeFetch(local("/slow"), options)).rejects.toThrow();
  });

  it("refuses loopback without the explicit test allowance", async () => {
    await expect(
      safeFetch(local("/ok"), { ...options, dangerouslyAllowAddresses: [] }),
    ).rejects.toThrow(/loopback/);
  });
});
