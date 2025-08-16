import winston from 'winston';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';

interface LogContext {
  operation?: string;
  repository?: string;
  commit?: string;
  branch?: string;
  correlationId?: string;
  duration?: number;
  error?: Error;
  // Allow any additional context fields
  [key: string]: unknown;
}

class StructuredLogger {
  private logger: winston.Logger;
  private correlationId: string;

  constructor() {
    this.correlationId = this.generateCorrelationId();
    this.logger = this.createLogger();
  }

  private generateCorrelationId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private createLogger(): winston.Logger {
    const logDir = './logs';
    fs.ensureDirSync(logDir);

    const formats = [
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
    ];

    const transports: winston.transport[] = [];

    // Console transport with colored output for development
    if (process.env.NODE_ENV !== 'production') {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const correlationId = (meta.correlationId as string) || this.correlationId;
              const context = meta.operation ? `[${meta.operation}]` : '';
              return `${timestamp} [${level}] ${context} [${correlationId.substring(0, 8)}]: ${message}`;
            }),
          ),
        }),
      );
    } else {
      // Production console output - structured JSON
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(...formats, winston.format.json()),
        }),
      );
    }

    // File transports for persistent logging
    transports.push(
      // All logs
      new winston.transports.File({
        filename: path.join(logDir, 'app.log'),
        format: winston.format.combine(...formats, winston.format.json()),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      }),
      // Error logs only
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: winston.format.combine(...formats, winston.format.json()),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
      }),
    );

    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(...formats),
      transports,
      defaultMeta: {
        service: 'git-contribution-scorer',
        version: '1.0.0',
        correlationId: this.correlationId,
      },
    });
  }

  private log(level: string, message: string, context?: LogContext): void {
    const logData = {
      message,
      correlationId: context?.correlationId || this.correlationId,
      ...context,
    };

    // Remove undefined values
    Object.keys(logData).forEach(key => {
      if (logData[key as keyof typeof logData] === undefined) {
        delete logData[key as keyof typeof logData];
      }
    });

    this.logger.log(level, logData);
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | string, context?: LogContext): void {
    let errorObj: Error | undefined;
    let errorMessage = message;

    if (typeof error === 'string') {
      errorMessage = `${message}: ${error}`;
    } else if (error instanceof Error) {
      errorObj = error;
      errorMessage = `${message}: ${error.message}`;
    }

    this.log('error', errorMessage, {
      ...context,
      error: errorObj,
      stack: errorObj?.stack,
    } as LogContext);
  }

  createChildLogger(context: LogContext): StructuredLogger {
    const child = new StructuredLogger();
    child.correlationId = context.correlationId || this.correlationId;
    return child;
  }

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  getCorrelationId(): string {
    return this.correlationId;
  }

  // Timer utility for performance logging
  startTimer(operation: string, context?: LogContext): () => void {
    const startTime = Date.now();
    this.debug(`Starting operation: ${operation}`, { ...context, operation });

    return () => {
      const duration = Date.now() - startTime;
      this.info(`Completed operation: ${operation}`, {
        ...context,
        operation,
        duration,
      });
    };
  }

  // Async operation wrapper with automatic error handling
  async withOperation<T>(operation: string, fn: () => Promise<T>, context?: LogContext): Promise<T> {
    const endTimer = this.startTimer(operation, context);
    try {
      const result = await fn();
      endTimer();
      return result;
    } catch (error) {
      endTimer();
      this.error(`Operation failed: ${operation}`, error as Error, {
        ...context,
        operation,
      });
      throw error;
    }
  }

  set level(level: string) {
    this.logger.level = level;
  }

  get level(): string {
    return this.logger.level;
  }
}

// Create singleton instance
export const logger = new StructuredLogger();

// Legacy compatibility functions
export function setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
  logger.level = level;
}

export function createChildLogger(metadata: LogContext): StructuredLogger {
  return logger.createChildLogger(metadata);
}

// Prompt logging system
export enum PromptType {
  BUSINESS_ANALYSIS = 'Business Analysis',
  CODE_COMPARISON = 'Code Comparison',
  GITHUB_EVALUATION = 'GitHub Evaluation',
  CLAUDE_CODE_INITIAL = 'Claude Code Initial'
}

interface PromptStyle {
  color: chalk.ChalkFunction;
  emoji: string;
}

const PROMPT_STYLES: Record<PromptType, PromptStyle> = {
  [PromptType.BUSINESS_ANALYSIS]: { color: chalk.green, emoji: '🟢' },
  [PromptType.CODE_COMPARISON]: { color: chalk.blue, emoji: '🔵' },
  [PromptType.GITHUB_EVALUATION]: { color: chalk.magenta, emoji: '🟣' },
  [PromptType.CLAUDE_CODE_INITIAL]: { color: chalk.yellow, emoji: '🟡' }
};

export function logPrompt(promptType: PromptType, prompt: string): void {
  const style = PROMPT_STYLES[promptType];
  const startMarker = style.color(`${style.emoji} PROMPT: ${promptType}`);
  const endMarker = style.color(`${style.emoji} END: ${promptType}`);
  
  logger.debug(startMarker);
  logger.debug(prompt);
  logger.debug(endMarker);
}

// Export types for use in other modules
export type { LogContext };
