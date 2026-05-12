/**
 * Base error type for Argus. All thrown errors in production paths should
 * extend this so handlers can match by `code` instead of string parsing.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  override readonly cause?: unknown;
  readonly meta?: Record<string, unknown>;

  constructor(opts: {
    code: string;
    message: string;
    status?: number;
    cause?: unknown;
    meta?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.status = opts.status ?? 500;
    this.cause = opts.cause;
    this.meta = opts.meta;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super({ code: 'validation_error', message, status: 400, meta });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super({ code: 'not_found', message, status: 404, meta });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super({ code: 'unauthorized', message, status: 401 });
  }
}

export class ConnectorError extends AppError {
  constructor(message: string, cause?: unknown, meta?: Record<string, unknown>) {
    super({ code: 'connector_error', message, status: 502, cause, meta });
  }
}

export class ProviderError extends AppError {
  constructor(message: string, cause?: unknown, meta?: Record<string, unknown>) {
    super({ code: 'provider_error', message, status: 502, cause, meta });
  }
}

export class InvestigatorError extends AppError {
  constructor(message: string, cause?: unknown, meta?: Record<string, unknown>) {
    super({ code: 'investigator_error', message, status: 500, cause, meta });
  }
}
