export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "CSRF_REJECTED",
  "DOMAIN_INVALID",
  "DOMAIN_ALREADY_EXISTS",
  "ANALYSIS_ALREADY_QUEUED",
  "RULESET_NOT_EDITABLE",
  "RULESET_INVALID",
  "SCORE_MODEL_INVALID",
  "IMPORT_TOO_LARGE",
  "IMPORT_INVALID",
  "CRAWLER_JOB_NOT_FOUND",
  "CRAWLER_JOB_NOT_CLAIMED",
  "CRAWLER_JOB_LEASE_EXPIRED",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_DISABLED",
  "PROVIDER_DECISION_PENDING",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_QUOTA_EXHAUSTED",
  "PROVIDER_BUDGET_EXHAUSTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UPSTREAM_ERROR",
  "PROVIDER_CIRCUIT_OPEN",
  "PROVIDER_INVALID_INPUT",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF_REJECTED: 403,
  DOMAIN_INVALID: 400,
  DOMAIN_ALREADY_EXISTS: 409,
  ANALYSIS_ALREADY_QUEUED: 409,
  RULESET_NOT_EDITABLE: 409,
  RULESET_INVALID: 400,
  SCORE_MODEL_INVALID: 400,
  IMPORT_TOO_LARGE: 413,
  IMPORT_INVALID: 400,
  CRAWLER_JOB_NOT_FOUND: 404,
  CRAWLER_JOB_NOT_CLAIMED: 409,
  CRAWLER_JOB_LEASE_EXPIRED: 409,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_DISABLED: 503,
  PROVIDER_DECISION_PENDING: 503,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_AUTH_FAILED: 502,
  PROVIDER_QUOTA_EXHAUSTED: 429,
  PROVIDER_BUDGET_EXHAUSTED: 429,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UPSTREAM_ERROR: 502,
  PROVIDER_CIRCUIT_OPEN: 503,
  PROVIDER_INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * Application error with a stable machine-readable code.
 * Messages must be safe to show to end users (no secrets, no stack traces).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { statusCode?: number; details?: unknown; cause?: unknown },
  ) {
    super(message ?? code, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.statusCode = options?.statusCode ?? DEFAULT_STATUS[code];
    this.details = options?.details;
  }

  static is(error: unknown): error is AppError {
    return (
      error instanceof AppError ||
      (typeof error === "object" &&
        error !== null &&
        (error as { name?: string }).name === "AppError")
    );
  }
}

export function errorStatusFor(code: ErrorCode): number {
  return DEFAULT_STATUS[code];
}
