import type { ApiConfig } from "@dominio-x/config";
import type { DatabaseHandle } from "@dominio-x/database";
import type { CoreContext } from "@dominio-x/domain-core";
import type { Redis } from "ioredis";

export interface ApiDeps {
  config: ApiConfig;
  database: DatabaseHandle;
  /** Null only in tests without Redis (rate limits fall back to in-memory). */
  redis: Redis | null;
  core: CoreContext;
  /** Optional readiness probe for object storage (not part of /ready by default: buckets can be slow). */
  storageHealth?: () => Promise<{ ok: boolean; error?: string }>;
}
