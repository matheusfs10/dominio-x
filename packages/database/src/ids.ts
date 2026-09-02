import { v7 as uuidv7 } from "uuid";

/** Time-ordered UUIDv7 primary keys: index-friendly and sortable by creation. */
export function newId(): string {
  return uuidv7();
}
