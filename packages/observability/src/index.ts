import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger };

/** Keys that must never appear in logs. Applied as pino redaction paths. */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "apiKey",
  "*.apiKey",
  "api_key",
  "*.api_key",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-machine-token']",
  "res.headers['set-cookie']",
  "SESSION_SECRET",
  "CRAWLER_MACHINE_TOKEN",
  "SEMRUSH_API_KEY",
  "DATAFORSEO_PASSWORD",
  "DATAFORSEO_LOGIN",
  "S3_SECRET_ACCESS_KEY",
  "DATABASE_URL",
  "REDIS_URL",
];

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
  base?: Record<string, unknown>;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const pinoOptions: LoggerOptions = {
    level: options.level ?? "info",
    base: { service: options.service, ...options.base },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };
  return pino(pinoOptions);
}

/**
 * Redacts secret-looking values inside a URL (e.g. postgres://user:pass@host → postgres://user:***@host).
 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    if (url.username && url.password === "") url.username = "***";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

/**
 * Returns an error message safe for persistence/exposure: no stack, bounded length,
 * with obvious credential-looking fragments removed.
 */
export function sanitizeErrorMessage(error: unknown, maxLength = 500): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return message
    .replace(/(api[_-]?key|token|password|secret)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/:\/\/([^:/\s]+):([^@/\s]+)@/g, "://$1:***@")
    .slice(0, maxLength);
}

export interface SentryLike {
  captureException(error: unknown, context?: Record<string, unknown>): void;
}

let sentryInstance: SentryLike | null = null;

/**
 * Initializes Sentry only when a DSN is present. Safe to call multiple times.
 */
export async function initSentry(options: {
  dsn?: string;
  service: string;
  environment: string;
}): Promise<SentryLike | null> {
  if (!options.dsn) return null;
  if (sentryInstance) return sentryInstance;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    serverName: options.service,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  sentryInstance = {
    captureException: (error, context) => {
      Sentry.captureException(error, context ? { extra: context } : undefined);
    },
  };
  return sentryInstance;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  sentryInstance?.captureException(error, context);
}
