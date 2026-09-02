import type { App } from "../app.js";
import type { ApiDeps } from "../deps.js";
import { analysisRoutes } from "./analysis-runs.js";
import { auditRoutes } from "./audit.js";
import { authRoutes } from "./auth.js";
import { batchRoutes } from "./batches.js";
import { dashboardRoutes } from "./dashboard.js";
import { domainRoutes } from "./domains.js";
import { healthRoutes } from "./health.js";
import { internalCrawlerRoutes } from "./internal-crawler.js";
import { providerRoutes } from "./providers.js";
import { rulesetRoutes } from "./rulesets.js";
import { settingsRoutes } from "./settings.js";
import { shortlistRoutes } from "./shortlists.js";
import { usageRoutes } from "./usage.js";
import { userRoutes } from "./users.js";

export async function registerRoutes(app: App, deps: ApiDeps): Promise<void> {
  await app.register(healthRoutes, { deps });
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { deps });
      await v1.register(dashboardRoutes, { deps });
      await v1.register(domainRoutes, { deps });
      await v1.register(batchRoutes, { deps });
      await v1.register(analysisRoutes, { deps });
      await v1.register(shortlistRoutes, { deps });
      await v1.register(rulesetRoutes, { deps });
      await v1.register(providerRoutes, { deps });
      await v1.register(usageRoutes, { deps });
      await v1.register(auditRoutes, { deps });
      await v1.register(settingsRoutes, { deps });
      await v1.register(userRoutes, { deps });
      await v1.register(internalCrawlerRoutes, { deps });
    },
    { prefix: "/v1" },
  );
}
