export const ErrorCode = {
  // General
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",

  // Reddit
  REDDIT_API_ERROR: "REDDIT_API_ERROR",

  // LLM
  SCHEMA_VALIDATION_FAILED: "SCHEMA_VALIDATION_FAILED",
  JSON_PARSE_FAILED: "JSON_PARSE_FAILED",
  INVALID_POST_INDICES: "INVALID_POST_INDICES",
  WRONG_SELECTION_COUNT: "WRONG_SELECTION_COUNT",
  CONTENT_POLICY_REFUSAL: "CONTENT_POLICY_REFUSAL",
  API_TIMEOUT: "API_TIMEOUT",
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  ALL_RETRIES_EXHAUSTED: "ALL_RETRIES_EXHAUSTED",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export class RedgestError extends Error {
  readonly code: ErrorCodeType;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCodeType,
    message: string,
    details?: Record<string, unknown>,
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = "RedgestError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}
