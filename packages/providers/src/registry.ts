import type { Redis } from "ioredis";
import type {
  AhrefsConfig,
  CapSolverConfig,
  DataForSeoConfig,
  PipelineConfig,
  SemrushConfig,
} from "@dominio-x/config";
import { AhrefsProvider } from "./ahrefs/index.js";
import { CapSolver } from "./capsolver/index.js";
import { DataForSeoProvider } from "./dataforseo/index.js";
import { DnsProvider } from "./dns/index.js";
import { LexicalProvider } from "./lexical/index.js";
import { RdapProvider } from "./rdap/index.js";
import { SemrushProvider } from "./semrush/index.js";
import type { EnrichmentProvider } from "./types.js";

export interface ProviderRegistry {
  lexical: LexicalProvider;
  dns: DnsProvider;
  rdap: RdapProvider;
  semrush: SemrushProvider;
  dataforseo: DataForSeoProvider;
  ahrefs: AhrefsProvider;
  /** Not an enrichment provider: a paid dependency of the providers behind a challenge. */
  capsolver: CapSolver;
  all(): EnrichmentProvider[];
  get(key: string): EnrichmentProvider | undefined;
}

export function createProviderRegistry(options: {
  pipeline: PipelineConfig;
  semrush: SemrushConfig;
  dataforseo: DataForSeoConfig;
  capsolver: CapSolverConfig;
  ahrefs: AhrefsConfig;
  redis?: Redis;
}): ProviderRegistry {
  const lexical = new LexicalProvider();
  const dns = new DnsProvider({ ttlHours: options.pipeline.DNS_TTL_HOURS });
  const rdap = new RdapProvider({
    enabled: options.pipeline.RDAP_ENABLED,
    ttlHours: options.pipeline.RDAP_TTL_HOURS,
  });
  const semrush = new SemrushProvider({ config: options.semrush, redis: options.redis });
  const dataforseo = new DataForSeoProvider({ config: options.dataforseo, redis: options.redis });
  const capsolver = new CapSolver({ config: options.capsolver });
  const ahrefs = new AhrefsProvider({
    config: options.ahrefs,
    solver: capsolver,
    redis: options.redis,
  });
  const list: EnrichmentProvider[] = [lexical, dns, rdap, semrush, dataforseo, ahrefs];
  return {
    lexical,
    dns,
    rdap,
    semrush,
    dataforseo,
    ahrefs,
    capsolver,
    all: () => list,
    get: (key) => list.find((p) => p.key === key),
  };
}
