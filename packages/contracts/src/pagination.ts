import { z } from "zod";

export const PAGINATION_MAX_LIMIT = 200;
export const PAGINATION_DEFAULT_LIMIT = 50;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

/** Opaque keyset cursor helpers (base64url JSON). */
export function encodeCursor(value: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T extends Record<string, string | number | null>>(
  cursor: string | undefined,
  schema: z.ZodType<T>,
): T | null {
  if (!cursor) return null;
  try {
    const raw: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return schema.parse(raw);
  } catch {
    return null;
  }
}
