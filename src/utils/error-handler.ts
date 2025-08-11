import { logger, LogContext } from './logger.js';

export interface AppError extends Error {
  code: string;
  statusCode?: number;
  context?: Record<string, unknown>;
  correlationId?: string;
}

export class DevScorerError extends Error implements AppError {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly context?: Record<string, unknown>;
  public readonly correlationId?: string;

  constructor(message: string, code: string, statusCode?: number, context?: Record<string, unknown>) {
    super(message);
    this.name = 'DevScorerError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.correlationId = logger.getCorrelationId();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DevScorerError);
    }
  }
}

// Pre-defined error types
export class RepositoryError extends DevScorerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'REPOSITORY_ERROR', undefined, context);
    this.name = 'RepositoryError';
  }
}

export class GitAnalysisError extends DevScorerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'GIT_ANALYSIS_ERROR', undefined, context);
    this.name = 'GitAnalysisError';
  }
}

export class ClaudeCodeError extends DevScorerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CLAUDE_CODE_ERROR', undefined, context);
    this.name = 'ClaudeCodeError';
  }
}

export class ConfigurationError extends DevScorerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', undefined, context);
    this.name = 'ConfigurationError';
  }
}

export class ValidationError extends DevScorerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', undefined, context);
    this.name = 'ValidationError';
  }
}

export class ErrorHandler {
  static handle(error: unknown, operation?: string, context?: LogContext): AppError {
    // Generate correlation ID if not present
    const correlationId = context?.correlationId || logger.getCorrelationId();

    // If it's already our error type, just log and return
    if (error instanceof DevScorerError) {
      logger.error(`Operation failed: ${operation || 'unknown'}`, error, {
        ...context,
        operation,
        correlationId,
        errorCode: error.code,
      });
      return error;
    }

    // Handle standard Error objects
    if (error instanceof Error) {
      const appError = new DevScorerError(error.message, 'UNKNOWN_ERROR', undefined, {
        originalError: error.name,
        stack: error.stack,
        ...context,
      });

      logger.error(`Operation failed: ${operation || 'unknown'}`, error, {
        ...context,
        operation,
        correlationId,
        errorCode: appError.code,
      });

      return appError;
    }

    // Handle string errors
    if (typeof error === 'string') {
      const appError = new DevScorerError(error, 'STRING_ERROR', undefined, { ...context });

      logger.error(`Operation failed: ${operation || 'unknown'}`, undefined, {
        ...context,
        operation,
        correlationId,
        errorCode: appError.code,
        originalError: error,
      });

      return appError;
    }

    // Handle unknown error types
    const appError = new DevScorerError('An unknown error occurred', 'UNKNOWN_ERROR_TYPE', undefined, {
      originalError: String(error),
      ...context,
    });

    logger.error(`Operation failed: ${operation || 'unknown'}`, undefined, {
      ...context,
      operation,
      correlationId,
      errorCode: appError.code,
      originalError: String(error),
    });

    return appError;
  }

  static async wrapAsync<T>(fn: () => Promise<T>, operation: string, context?: LogContext): Promise<T> {
    try {
      return await logger.withOperation(operation, fn, context);
    } catch (error) {
      throw ErrorHandler.handle(error, operation, context);
    }
  }

  static wrap<T>(fn: () => T, operation: string, context?: LogContext): T {
    try {
      const startTime = Date.now();
      logger.debug(`Starting operation: ${operation}`, { ...context, operation });

      const result = fn();

      const duration = Date.now() - startTime;
      logger.info(`Completed operation: ${operation}`, {
        ...context,
        operation,
        duration,
      });

      return result;
    } catch (error) {
      throw ErrorHandler.handle(error, operation, context);
    }
  }

  static formatForUser(error: AppError): string {
    const correlationSuffix = error.correlationId ? ` (Error ID: ${error.correlationId.substring(0, 8)})` : '';

    return `${error.message}${correlationSuffix}`;
  }

  static isRetryable(error: AppError): boolean {
    const retryableCodes = ['NETWORK_ERROR', 'TIMEOUT_ERROR', 'RATE_LIMIT_ERROR', 'TEMPORARY_ERROR'];

    return retryableCodes.includes(error.code);
  }

  static extractContext(error: AppError): Record<string, unknown> {
    return {
      code: error.code,
      message: error.message,
      correlationId: error.correlationId,
      context: error.context,
      stack: error.stack,
    };
  }
}

// Utility function for creating retry logic
export async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  context?: LogContext,
): Promise<T> {
  let lastError: AppError | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await ErrorHandler.wrapAsync(fn, operation, {
        ...context,
        attempt,
        maxRetries,
      });
    } catch (error) {
      lastError = ErrorHandler.handle(error, operation, { ...context, attempt });

      if (attempt === maxRetries || !ErrorHandler.isRetryable(lastError)) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
      logger.warn(`Operation ${operation} failed, retrying in ${delay}ms`, {
        ...context,
        operation,
        attempt,
        maxRetries,
        delay,
        errorCode: lastError.code,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
