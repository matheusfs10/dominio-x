import { describe, expect, it } from "vitest";
import { extractHostname, normalizeDomain } from "./index.js";

describe("extractHostname", () => {
  it("strips scheme, path, query, port and trailing dot", () => {
    expect(extractHostname("https://Example.COM.BR:443/path?q=1#x")).toBe("example.com.br");
    expect(extractHostname("  example.com.  ")).toBe("example.com");
    expect(extractHostname("user:pw@example.com/x")).toBe("example.com");
  });
  it("returns null for empty input", () => {
    expect(extractHostname("   ")).toBeNull();
    expect(extractHostname("https://")).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("normalizes a simple .com.br domain", () => {
    const r = normalizeDomain("Exemplo.Com.Br");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.asciiFqdn).toBe("exemplo.com.br");
    expect(r.registrableDomain).toBe("exemplo.com.br");
    expect(r.sld).toBe("exemplo");
    expect(r.tld).toBe("com.br");
    expect(r.isSubdomain).toBe(false);
    expect(r.isIdn).toBe(false);
  });

  it("derives registrable domain for subdomains", () => {
    const r = normalizeDomain("www.blog.exemplo.com.br");
    expect(r.ok && r.registrableDomain).toBe("exemplo.com.br");
    expect(r.ok && r.isSubdomain).toBe(true);
  });

  it("converts IDN to punycode and preserves unicode", () => {
    const r = normalizeDomain("São.com.br");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.asciiFqdn).toBe("xn--so-sia.com.br");
    expect(r.unicodeFqdn).toBe("são.com.br");
    expect(r.isIdn).toBe(true);
    expect(r.sld).toBe("xn--so-sia");
  });

  it("accepts an already punycoded domain", () => {
    const r = normalizeDomain("XN--SO-SIA.com.br");
    expect(r.ok && r.asciiFqdn).toBe("xn--so-sia.com.br");
    expect(r.ok && r.unicodeFqdn).toBe("são.com.br");
  });

  it("rejects IP addresses", () => {
    expect(normalizeDomain("127.0.0.1")).toMatchObject({ ok: false, code: "IP_ADDRESS" });
    expect(normalizeDomain("[::1]")).toMatchObject({ ok: false, code: "IP_ADDRESS" });
    expect(normalizeDomain("http://10.0.0.1/")).toMatchObject({ ok: false, code: "IP_ADDRESS" });
  });

  it("rejects localhost and malformed hostnames", () => {
    expect(normalizeDomain("localhost")).toMatchObject({ ok: false, code: "LOCALHOST" });
    expect(normalizeDomain("foo.localhost")).toMatchObject({ ok: false, code: "LOCALHOST" });
    expect(normalizeDomain("")).toMatchObject({ ok: false, code: "EMPTY" });
    expect(normalizeDomain("exa mple.com").ok).toBe(false);
    expect(normalizeDomain("-bad.com")).toMatchObject({ ok: false, code: "INVALID_LABEL" });
    expect(normalizeDomain("bad-.com")).toMatchObject({ ok: false, code: "INVALID_LABEL" });
    expect(normalizeDomain("a..b.com").ok).toBe(false);
    expect(normalizeDomain("justonelabel")).toMatchObject({ ok: false, code: "NO_TLD" });
  });

  it("rejects unknown TLDs and bare public suffixes", () => {
    expect(normalizeDomain("example.notatld")).toMatchObject({ ok: false, code: "UNKNOWN_TLD" });
    expect(normalizeDomain("com.br")).toMatchObject({ ok: false, code: "NOT_REGISTRABLE" });
  });

  it("enforces length constraints", () => {
    const longLabel = "a".repeat(64) + ".com";
    expect(normalizeDomain(longLabel)).toMatchObject({ ok: false, code: "LABEL_TOO_LONG" });
    const longFqdn = Array.from({ length: 10 }, () => "a".repeat(30)).join(".") + ".com";
    expect(normalizeDomain(longFqdn)).toMatchObject({ ok: false, code: "TOO_LONG" });
  });

  it("is deterministic", () => {
    const a = normalizeDomain("HTTPS://Exemplo.COM.BR./");
    const b = normalizeDomain("exemplo.com.br");
    expect(a.ok && b.ok && a.asciiFqdn === b.asciiFqdn).toBe(true);
  });
});
