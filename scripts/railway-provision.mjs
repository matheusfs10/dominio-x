#!/usr/bin/env node
/**
 * Provisions and deploys Dominio-X on Railway through the public GraphQL API.
 * Works without the Railway CLI. Idempotent: reads/writes `.railway/state.json`.
 *
 *   RAILWAY_API_TOKEN=... node scripts/railway-provision.mjs provision   # projects, databases, bucket, services, domains
 *   RAILWAY_API_TOKEN=... node scripts/railway-provision.mjs configure   # instance settings (build/start/health/cron/pre-deploy)
 *   RAILWAY_API_TOKEN=... node scripts/railway-provision.mjs variables   # variables (secrets generated once, stored only in Railway)
 *   RAILWAY_API_TOKEN=... node scripts/railway-provision.mjs deploy [service...]   # upload the committed tree and deploy
 *   RAILWAY_API_TOKEN=... node scripts/railway-provision.mjs status
 *
 * Never prints secrets. Never deletes resources.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, ".railway", "state.json");
const token = process.env.RAILWAY_API_TOKEN;
if (!token) {
  console.error("RAILWAY_API_TOKEN is required (workspace/account token).");
  process.exit(2);
}
const API = "https://backboard.railway.com/graphql/v2";
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

const APP_SERVICES = {
  api: {
    build:
      "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/api --filter=@dominio-x/database",
    start: "node apps/api/dist/server.js",
    preDeploy: ["node packages/database/dist/migrate.js"],
    healthcheck: "/health",
    watch: ["apps/api/**", "packages/**", "pnpm-lock.yaml", "package.json", "turbo.json"],
    port: 4000,
  },
  worker: {
    build: "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/worker",
    start: "node apps/worker/dist/worker.js",
    watch: ["apps/worker/**", "packages/**", "pnpm-lock.yaml", "package.json", "turbo.json"],
  },
  "scheduler-registro-br": {
    build: "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/scheduler",
    start: "node apps/scheduler/dist/registro-br.js",
    cron: "0 */6 * * *",
    watch: ["apps/scheduler/**", "packages/**", "pnpm-lock.yaml", "package.json", "turbo.json"],
  },
  web: {
    build: "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/web",
    start: "pnpm --filter @dominio-x/web start",
    healthcheck: "/api/health",
    watch: ["apps/web/**", "packages/contracts/**", "pnpm-lock.yaml", "package.json", "turbo.json"],
    port: 3000,
  },
};
const CRAWLER_SERVICE = {
  build: "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@dominio-x/crawler",
  start: "node apps/crawler/dist/crawler.js",
  watch: [
    "apps/crawler/**",
    "packages/config/**",
    "packages/contracts/**",
    "packages/observability/**",
    "pnpm-lock.yaml",
    "package.json",
    "turbo.json",
  ],
};

async function ensureProject(key, name, description) {
  if (state[key].projectId) return;
  const d = await gql(
    `mutation($name: String!, $description: String!) { projectCreate(input: { name: $name, description: $description, defaultEnvironmentName: "production" }) { id workspaceId environments { edges { node { id name } } } } }`,
    { name, description },
  );
  state[key].projectId = d.projectCreate.id;
  state[key].environmentId = d.projectCreate.environments.edges[0].node.id;
  if (d.projectCreate.workspaceId) state[key].workspaceId = d.projectCreate.workspaceId;
  save();
  console.log(`project ${name} created`);
}

async function ensureService(key, name) {
  if (state[key].services[name]) return state[key].services[name];
  const d = await gql(
    `mutation($projectId: String!, $name: String!) { serviceCreate(input: { projectId: $projectId, name: $name }) { id } }`,
    { projectId: state[key].projectId, name },
  );
  state[key].services[name] = d.serviceCreate.id;
  save();
  console.log(`service ${name} created`);
  return d.serviceCreate.id;
}

async function ensureTemplate(code, serviceName) {
  if (state.core.services[serviceName]) return;
  const t = (
    await gql(`query($code: String!) { template(code: $code) { id serializedConfig } }`, { code })
  ).template;
  await gql(
    `mutation($input: TemplateDeployV2Input!) { templateDeployV2(input: $input) { workflowId } }`,
    {
      input: {
        templateId: t.id,
        serializedConfig: t.serializedConfig,
        projectId: state.core.projectId,
        environmentId: state.core.environmentId,
      },
    },
  );
  console.log(`template ${code} deploy requested; run 'status' to pick up the service id`);
}

async function ensureBucket() {
  if (state.core.bucket?.id) return;
  const d = await gql(
    `mutation($projectId: String!, $environmentId: String!) { bucketCreate(input: { projectId: $projectId, environmentId: $environmentId, name: "dominio-x-data" }) { id name } }`,
    { projectId: state.core.projectId, environmentId: state.core.environmentId },
  );
  state.core.bucket = { id: d.bucketCreate.id, name: d.bucketCreate.name };
  save();
  console.log("bucket created");
}

async function ensureDomain(name, port) {
  if (state.core.domains[name]) return;
  const d = await gql(
    `mutation($serviceId: String!, $environmentId: String!, $port: Int!) { serviceDomainCreate(input: { serviceId: $serviceId, environmentId: $environmentId, targetPort: $port }) { domain } }`,
    { serviceId: state.core.services[name], environmentId: state.core.environmentId, port },
  );
  state.core.domains[name] = `https://${d.serviceDomainCreate.domain}`;
  save();
  console.log(`domain for ${name}: ${state.core.domains[name]}`);
}

async function configure(scope, serviceId, cfg) {
  const input = {
    region: state.region,
    rootDirectory: "/",
    builder: "RAILPACK",
    buildCommand: cfg.build,
    startCommand: cfg.start,
    watchPatterns: cfg.watch,
    restartPolicyType: cfg.cron ? "NEVER" : "ON_FAILURE",
    ...(cfg.cron ? {} : { restartPolicyMaxRetries: 10 }),
    ...(cfg.healthcheck ? { healthcheckPath: cfg.healthcheck, healthcheckTimeout: 120 } : {}),
    ...(cfg.preDeploy ? { preDeployCommand: cfg.preDeploy } : {}),
    ...(cfg.cron ? { cronSchedule: cfg.cron } : {}),
  };
  await gql(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }`,
    { serviceId, environmentId: scope.environmentId, input },
  );
}

async function upsertVariables(scope, serviceId, variables) {
  await gql(
    `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
    {
      input: {
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        serviceId,
        variables,
        replace: false,
        skipDeploys: true,
      },
    },
  );
}

async function existingVariableNames(scope, serviceId) {
  try {
    const d = await gql(
      `query($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }`,
      { projectId: scope.projectId, environmentId: scope.environmentId, serviceId },
    );
    return new Set(Object.keys(d.variables));
  } catch {
    return new Set();
  }
}

async function deploy(scope, serviceId) {
  const archive = path.join(root, ".railway", "upload.tar.gz");
  execFileSync("git", ["archive", "--format=tar.gz", "-o", archive, "HEAD"], { cwd: root });
  // Like the Railway CLI: the gzip bytes are the raw body, sent with a multipart content-type header.
  const res = await fetch(
    `https://backboard.railway.com/project/${scope.projectId}/environment/${scope.environmentId}/up?serviceId=${serviceId}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "multipart/form-data" },
      body: fs.readFileSync(archive),
    },
  );
  fs.rmSync(archive, { force: true });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 300));
  return json.deploymentId;
}

async function status() {
  for (const key of ["core", "crawlers"]) {
    const d = await gql(
      `query($id: String!) { project(id: $id) { name services { edges { node { id name } } } environments { edges { node { id serviceInstances { edges { node { serviceName latestDeployment { id status } } } } } } } } }`,
      { id: state[key].projectId },
    );
    for (const e of d.project.services.edges)
      if (
        state[key].services[e.node.name] === null ||
        state[key].services[e.node.name] === undefined
      )
        state[key].services[e.node.name] = e.node.id;
    save();
    console.log(`== ${d.project.name}`);
    for (const env of d.project.environments.edges)
      for (const si of env.node.serviceInstances.edges)
        console.log(
          `  ${si.node.serviceName}: ${si.node.latestDeployment?.status ?? "no deployment"}`,
        );
  }
}

const cmd = process.argv[2];
try {
  if (cmd === "provision") {
    await ensureProject(
      "core",
      "dominio-x-core",
      "Dominio-X core: web, api, worker, scheduler, postgres, redis, bucket",
    );
    await ensureProject(
      "crawlers",
      "dominio-x-crawlers",
      "Dominio-X isolated crawler (no core credentials)",
    );
    await ensureTemplate("postgres", "Postgres");
    await ensureTemplate("redis", "Redis");
    await ensureBucket();
    for (const name of Object.keys(APP_SERVICES)) await ensureService("core", name);
    await ensureService("crawlers", "crawler");
    await ensureDomain("web", 3000);
    await ensureDomain("api", 4000);
    await status();
  } else if (cmd === "configure") {
    for (const [name, cfg] of Object.entries(APP_SERVICES))
      if (state.core.services[name]) await configure(state.core, state.core.services[name], cfg);
    if (state.crawlers.services.crawler)
      await configure(state.crawlers, state.crawlers.services.crawler, CRAWLER_SERVICE);
    console.log("service instances configured");
  } else if (cmd === "variables") {
    const secretsPath = process.env.RAILWAY_SECRETS_FILE;
    let secrets =
      secretsPath && fs.existsSync(secretsPath)
        ? JSON.parse(fs.readFileSync(secretsPath, "utf8"))
        : null;
    const apiVars = await existingVariableNames(state.core, state.core.services.api);
    if (!secrets && apiVars.has("SESSION_SECRET") && apiVars.has("CRAWLER_MACHINE_TOKEN")) {
      secrets = {
        SESSION_SECRET: "${{api.SESSION_SECRET}}",
        CRAWLER_MACHINE_TOKEN: "${{api.CRAWLER_MACHINE_TOKEN}}",
      };
      console.log("reusing existing secrets from the api service (references)");
    }
    secrets ??= {
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CRAWLER_MACHINE_TOKEN: randomBytes(32).toString("hex"),
    };
    const shared = {
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      REDIS_URL: "${{Redis.REDIS_URL}}",
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "${{dominio-x-data.ENDPOINT}}",
      S3_ACCESS_KEY_ID: "${{dominio-x-data.ACCESS_KEY_ID}}",
      S3_SECRET_ACCESS_KEY: "${{dominio-x-data.SECRET_ACCESS_KEY}}",
      S3_BUCKET: "${{dominio-x-data.BUCKET}}",
      S3_REGION: "${{dominio-x-data.REGION}}",
      S3_URL_STYLE: "virtual",
      APP_URL: state.core.domains.web,
      API_URL: state.core.domains.api,
      CRAWLER_ENABLED: "true",
      CRAWLER_JOB_LEASE_SECONDS: "120",
      CRAWLER_STAGE_WAIT_TIMEOUT_MS: "600000",
      SEMRUSH_ENABLED: "false",
      SEMRUSH_MAX_RPS: "8",
      SEMRUSH_MAX_CONCURRENCY: "8",
      SEMRUSH_DATA_TTL_DAYS: "30",
      PIPELINE_WORKER_CONCURRENCY: "5",
      DNS_TTL_HOURS: "24",
      HTTP_TTL_HOURS: "72",
      PROVIDER_RESTRICTED_RETENTION_DAYS: "30",
      REGISTRO_BR_RELEASE_URL: "https://registro.br/dominio/lista-processo-liberacao.txt",
      REGISTRO_BR_USER_AGENT: "Dominio-X/1.0 (+internal-domain-intelligence)",
      SESSION_SECRET: secrets.SESSION_SECRET,
      CRAWLER_MACHINE_TOKEN: secrets.CRAWLER_MACHINE_TOKEN,
    };
    const crawlerToken = secrets.CRAWLER_MACHINE_TOKEN.startsWith("${{")
      ? null
      : secrets.CRAWLER_MACHINE_TOKEN;
    await upsertVariables(state.core, state.core.services.api, {
      ...shared,
      PORT: "4000",
      HOST: "0.0.0.0",
      TRUST_PROXY: "true",
    });
    await upsertVariables(state.core, state.core.services.worker, shared);
    if (state.core.services["scheduler-registro-br"])
      await upsertVariables(state.core, state.core.services["scheduler-registro-br"], shared);
    await upsertVariables(state.core, state.core.services.web, {
      NODE_ENV: "production",
      API_URL: state.core.domains.api,
      APP_URL: state.core.domains.web,
      API_INTERNAL_URL: "http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000",
    });
    if (state.crawlers.services.crawler) {
      if (!crawlerToken)
        console.log(
          "crawler: CRAWLER_MACHINE_TOKEN must be set manually (cross-project references are not possible; copy the api value)",
        );
      await upsertVariables(state.crawlers, state.crawlers.services.crawler, {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
        CRAWLER_CORE_API_URL: state.core.domains.api,
        ...(crawlerToken ? { CRAWLER_MACHINE_TOKEN: crawlerToken } : {}),
        CRAWLER_CONNECT_TIMEOUT_MS: "5000",
        CRAWLER_TOTAL_TIMEOUT_MS: "12000",
        CRAWLER_MAX_REDIRECTS: "5",
        CRAWLER_MAX_BODY_BYTES: "2097152",
        CRAWLER_MAX_DECOMPRESSED_BYTES: "4194304",
        CRAWLER_POLL_INTERVAL_MS: "5000",
        CRAWLER_CONCURRENCY: "4",
      });
    }
    console.log("variables upserted (secrets not printed)");
  } else if (cmd === "deploy") {
    const targets = process.argv.slice(3);
    const all = targets.length ? targets : [...Object.keys(APP_SERVICES), "crawler"];
    for (const name of all) {
      const scope = name === "crawler" ? state.crawlers : state.core;
      const id = scope.services[name];
      if (!id) {
        console.log(`${name}: not provisioned, skipped`);
        continue;
      }
      console.log(`${name}: deployment ${await deploy(scope, id)}`);
    }
  } else if (cmd === "status") {
    await status();
  } else {
    console.error(
      "usage: railway-provision.mjs provision|configure|variables|deploy [service...]|status",
    );
    process.exit(2);
  }
} catch (error) {
  console.error("failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
