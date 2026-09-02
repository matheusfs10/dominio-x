import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { AppError, type ApiErrorBody } from "@dominio-x/contracts";
import { REDACT_PATHS, captureException } from "@dominio-x/observability";
import { buildAllowedOrigins, csrfGuard } from "./auth/csrf.js";
import { sessionLoader } from "./auth/session.js";
import type { ApiDeps } from "./deps.js";
import { registerRoutes } from "./routes/index.js";

export type App = FastifyInstance;

export async function buildApp(deps: ApiDeps): Promise<App> {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      base: { service: "api" },
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.BODY_LIMIT_BYTES,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  const allowedOrigins = buildAllowedOrigins(
    config.APP_URL,
    config.API_URL,
    config.CORS_ALLOWED_ORIGINS,
  );
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.has(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-request-id", "x-machine-token"],
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    ...(deps.redis ? { redis: deps.redis } : {}),
    nameSpace: "dx-rl:",
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (req, context) => ({
      error: {
        code: "RATE_LIMITED",
        message: `Too many requests. Retry in ${Math.ceil(context.ttl / 1000)}s.`,
        requestId: req.id,
      },
    }),
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Dominio-X API",
        version: "1.0.0",
        description: "Internal domain-intelligence platform API",
      },
      components: {
        securitySchemes: {
          cookie: { type: "apiKey", in: "cookie", name: "dx_session" },
          machine: { type: "apiKey", in: "header", name: "x-machine-token" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.addHook("onRequest", sessionLoader(deps));
  app.addHook("preHandler", csrfGuard(allowedOrigins));

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    const send = (status: number, body: ApiErrorBody) => reply.status(status).send(body);
    if (AppError.is(error)) {
      if (error.statusCode >= 500) request.log.error({ err: error }, "application error");
      return send(error.statusCode, {
        error: { code: error.code, message: error.message, requestId, details: error.details },
      });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return send(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          requestId,
          details: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (error instanceof ZodError) {
      return send(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          requestId,
          details: error.issues,
        },
      });
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "response serialization error");
      return send(500, {
        error: { code: "INTERNAL_ERROR", message: "Response serialization failed.", requestId },
      });
    }
    const status =
      typeof (error as { statusCode?: number }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (status === 429)
      return send(429, {
        error: { code: "RATE_LIMITED", message: "Too many requests.", requestId },
      });
    if (status === 413)
      return send(413, {
        error: { code: "IMPORT_TOO_LARGE", message: "Request body too large.", requestId },
      });
    if (status >= 500) {
      request.log.error({ err: error }, "unhandled error");
      captureException(error, { requestId, url: request.url });
      return send(500, {
        error: { code: "INTERNAL_ERROR", message: "Internal server error.", requestId },
      });
    }
    return send(status, {
      error: {
        code: status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
        message: (error as Error).message,
        requestId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send({
        error: { code: "NOT_FOUND", message: "Route not found.", requestId: request.id },
      } satisfies ApiErrorBody);
  });

  await registerRoutes(app, deps);
  return app;
}
