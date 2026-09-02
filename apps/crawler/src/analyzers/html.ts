/** Minimal, non-executing HTML metadata extraction (no DOM, no scripts). */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const n = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    if (code.startsWith("#")) {
      const n = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function clean(value: string, max: number): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim().slice(0, max);
}

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const title = clean(m[1] ?? "", 500);
  return title.length > 0 ? title : null;
}

export function extractMetaDescription(html: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const name = /\b(?:name|property)\s*=\s*["']?\s*(description|og:description)\s*["']?/i.exec(
      tag,
    );
    if (!name) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = content?.[1] ?? content?.[2] ?? content?.[3];
    if (value) {
      const cleaned = clean(value, 1000);
      if (cleaned.length > 0) return cleaned;
    }
  }
  return null;
}

export function analyzeHtml(
  body: Buffer,
  contentType: string | null,
): { title: string | null; metaDescription: string | null } {
  if (!contentType || !/html|xml/i.test(contentType) || body.length === 0)
    return { title: null, metaDescription: null };
  const html = body.subarray(0, 512 * 1024).toString("utf8");
  return { title: extractTitle(html), metaDescription: extractMetaDescription(html) };
}
