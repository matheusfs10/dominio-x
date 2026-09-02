import { describe, expect, it } from "vitest";
import { LexicalProvider, computeLexicalMetrics, tokenize } from "./index.js";

describe("lexical provider", () => {
  it("computes basic counts", () => {
    const m = computeLexicalMetrics({
      asciiFqdn: "loja-virtual2024.com.br",
      sld: "loja-virtual2024",
      tld: "com.br",
      isIdn: false,
    });
    expect(m.sldLength).toBe(16);
    expect(m.digitCount).toBe(4);
    expect(m.hyphenCount).toBe(1);
    expect(m.labelCount).toBe(3);
    expect(m.isComBr).toBe(true);
    expect(m.isBr).toBe(true);
    expect(m.tokens).toEqual(["loja", "virtual"]);
    expect(m.hasDictionaryToken).toBe(true);
  });

  it("flags punycode and repeated characters", () => {
    const m = computeLexicalMetrics({
      asciiFqdn: "xn--so-gia.com.br",
      sld: "xn--so-gia",
      tld: "com.br",
      isIdn: true,
    });
    expect(m.isPunycode).toBe(true);
    const r = computeLexicalMetrics({
      asciiFqdn: "zzzz.app.br",
      sld: "zzzz",
      tld: "app.br",
      isIdn: false,
    });
    expect(r.repeatedCharMaxRun).toBe(4);
  });

  it("rates random strings as more random than words", () => {
    const word = computeLexicalMetrics({
      asciiFqdn: "cafe.com.br",
      sld: "cafe",
      tld: "com.br",
      isIdn: false,
    });
    const random = computeLexicalMetrics({
      asciiFqdn: "zzzwdbhz.com.br",
      sld: "zzzwdbhz",
      tld: "com.br",
      isIdn: false,
    });
    const random2 = computeLexicalMetrics({
      asciiFqdn: "xkqjvtb.com.br",
      sld: "xkqjvtb",
      tld: "com.br",
      isIdn: false,
    });
    expect(random.randomnessScore).toBeGreaterThan(word.randomnessScore + 0.3);
    expect(random2.randomnessScore).toBeGreaterThan(0.6);
    expect(word.randomnessScore).toBeLessThan(0.35);
  });

  it("does not guess tokens it cannot recognize", () => {
    expect(tokenize("qwxzptk")).toEqual([]);
    expect(tokenize("super-mercado")).toEqual(["super", "mercado"]);
  });

  it("emits observations with measured state and no expiry", async () => {
    const p = new LexicalProvider();
    const r = await p.enrich({
      domain: {
        id: "d",
        asciiFqdn: "cafe.com.br",
        unicodeFqdn: "cafe.com.br",
        registrableDomain: "cafe.com.br",
        sld: "cafe",
        tld: "com.br",
        isIdn: false,
      },
      analysisRunId: "r",
    });
    expect(r.status).toBe("ok");
    expect(r.observations.every((o) => o.state === "measured" && o.ttlHours === null)).toBe(true);
    expect(r.observations.find((o) => o.metricKey === "lexical.sld_length")?.value).toBe(4);
  });
});
