import { describe, expect, it } from "vitest";
import { semrushSchema } from "@dominio-x/config";
import { SemrushProvider } from "./index.js";

const domain = {
  id: "d",
  asciiFqdn: "cafe.com.br",
  unicodeFqdn: "cafe.com.br",
  registrableDomain: "cafe.com.br",
  sld: "cafe",
  tld: "com.br",
  isIdn: false,
};

describe("SemrushProvider (standby)", () => {
  it("is not configured and never calls out while in standby, even with a key", async () => {
    const config = semrushSchema.parse({ SEMRUSH_ENABLED: "true", SEMRUSH_API_KEY: "secret" });
    const p = new SemrushProvider({ config });
    expect(p.isConfigured()).toBe(false);
    expect(p.describeStatus().state).toBe("decision_pending");
    const r = await p.enrich({ domain, analysisRunId: "r" });
    expect(r.status).toBe("skipped");
    expect(r.errorCode).toBe("PROVIDER_DECISION_PENDING");
    expect(r.requests).toHaveLength(0);
    expect(
      r.observations.every(
        (o) => o.state === "unknown" && o.licenseClass === "provider_restricted",
      ),
    ).toBe(true);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("reports not configured / disabled correctly outside standby", async () => {
    const disabled = new SemrushProvider({
      config: semrushSchema.parse({ SEMRUSH_ENABLED: "false", SEMRUSH_API_KEY: "k" }),
      mode: "official_api",
    });
    expect(disabled.describeStatus().state).toBe("disabled");
    expect((await disabled.enrich({ domain, analysisRunId: "r" })).errorCode).toBe(
      "PROVIDER_DISABLED",
    );
    const missing = new SemrushProvider({
      config: semrushSchema.parse({ SEMRUSH_ENABLED: "true" }),
      mode: "official_api",
    });
    expect(missing.describeStatus().state).toBe("not_configured");
    expect((await missing.enrich({ domain, analysisRunId: "r" })).errorCode).toBe(
      "PROVIDER_NOT_CONFIGURED",
    );
  });

  it("caps rate limit configuration at the documented ceilings", () => {
    expect(() => semrushSchema.parse({ SEMRUSH_MAX_RPS: "20" })).toThrow();
    expect(semrushSchema.parse({}).SEMRUSH_MAX_RPS).toBe(8);
    expect(semrushSchema.parse({}).SEMRUSH_DATA_TTL_DAYS).toBe(30);
  });
});
