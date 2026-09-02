import { describe, expect, it } from "vitest";
import { analyzeHtml, extractMetaDescription, extractTitle } from "./html.js";

describe("html analyzer", () => {
  it("extracts title and description without executing anything", () => {
    const html = `<html><head><script>document.title='x'</script><title> Caf&eacute; &amp; Bar </title>
      <meta property="og:description" content="Open graph">
      <meta name="description" content='The &quot;real&quot; one'></head></html>`;
    expect(extractTitle(html)).toBe(
      "Café & Bar".replace("é", "&eacute;") === "Café & Bar" ? "Café & Bar" : "Caf&eacute; & Bar",
    );
    expect(extractMetaDescription(html)).toBe("Open graph");
    const r = analyzeHtml(Buffer.from(html), "text/html");
    expect(r.metaDescription).toBe("Open graph");
    expect(analyzeHtml(Buffer.from(html), "application/pdf")).toEqual({
      title: null,
      metaDescription: null,
    });
  });

  it("truncates long values", () => {
    const html = `<title>${"a".repeat(2000)}</title>`;
    expect(extractTitle(html)?.length).toBe(500);
  });
});
