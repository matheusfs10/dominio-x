import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AppError,
  analyzeBatchBodySchema,
  importBatchBodySchema,
  listBatchesQuerySchema,
} from "@dominio-x/contracts";
import {
  analyzeBatch,
  getBatchDetail,
  ingestArtifact,
  listBatches,
  recordAudit,
} from "@dominio-x/domain-core";
import { CsvSourceAdapter } from "@dominio-x/source-adapters";
import { actorOf, requireRole, requireUser } from "../auth/session.js";
import type { ApiDeps } from "../deps.js";

const idParams = z.object({ batchId: z.string().uuid() });

export const batchRoutes: FastifyPluginAsync<{ deps: ApiDeps }> = async (app, { deps }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const core = deps.core;

  r.get(
    "/batches",
    {
      schema: { tags: ["batches"], querystring: listBatchesQuerySchema },
      preHandler: requireRole("viewer"),
    },
    async (request) => listBatches(core.db, request.query),
  );

  r.get(
    "/batches/:batchId",
    { schema: { tags: ["batches"], params: idParams }, preHandler: requireRole("viewer") },
    async (request) => getBatchDetail(core.db, request.params.batchId),
  );

  r.get(
    "/batches/:batchId/artifact-url",
    { schema: { tags: ["batches"], params: idParams }, preHandler: requireRole("analyst") },
    async (request) => {
      const { batch } = await getBatchDetail(core.db, request.params.batchId);
      if (!batch.artifactKey) throw new AppError("NOT_FOUND", "Batch has no stored artifact.");
      const url = await core.storage.createPresignedGetUrl({
        key: batch.artifactKey,
        expiresInSeconds: 300,
      });
      return { url, expiresInSeconds: 300, key: batch.artifactKey };
    },
  );

  r.post(
    "/batches/import",
    {
      schema: { tags: ["batches"], body: importBatchBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) => {
      const user = requireUser(request);
      const adapter = new CsvSourceAdapter({
        maxBytes: deps.config.BODY_LIMIT_BYTES,
        maxRows: deps.config.CSV_IMPORT_MAX_ROWS,
      });
      let artifact;
      try {
        artifact = adapter.artifactFromContent(request.body.content, { importedBy: user.email });
      } catch (error) {
        throw new AppError(
          "IMPORT_TOO_LARGE",
          error instanceof Error ? error.message : "Import too large.",
        );
      }
      let result;
      try {
        result = await ingestArtifact(core, {
          adapter,
          artifact,
          name: request.body.name ?? `CSV import ${new Date().toISOString()}`,
          createdBy: user.id,
          analyze: request.body.analyze,
          triggerType: "csv_import",
        });
      } catch (error) {
        if (error instanceof Error && error.name === "ParseLimitError")
          throw new AppError("IMPORT_INVALID", error.message);
        throw error;
      }
      const parse = (result.batch.metadataJson as { parse?: { issues?: unknown[] } }).parse;
      await recordAudit(core.db, {
        action: "batch.imported",
        actor: actorOf(request),
        targetType: "batch",
        targetId: result.batch.id,
        details: { created: result.created, ...result.stats },
      });
      return reply
        .status(result.created ? 201 : 200)
        .send({
          batch: result.batch,
          created: result.created,
          stats: result.stats,
          issues: parse?.issues ?? [],
        });
    },
  );

  r.post(
    "/batches/:batchId/analyze",
    {
      schema: { tags: ["batches"], params: idParams, body: analyzeBatchBodySchema },
      preHandler: requireRole("analyst"),
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await analyzeBatch(core, request.params.batchId, {
        onlyNew: request.body.onlyNew,
        forceRefresh: request.body.forceRefresh,
        requestedBy: user.id,
      });
      await recordAudit(core.db, {
        action: "batch.analysis_requested",
        actor: actorOf(request),
        targetType: "batch",
        targetId: request.params.batchId,
        details: { ...request.body, ...result },
      });
      return reply.status(202).send(result);
    },
  );
};
