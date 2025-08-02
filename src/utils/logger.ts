import winston from 'winston';

const createLogger = () => {
  const formats = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ];

  if (process.env.NODE_ENV !== 'production') {
    formats.push(
      winston.format.colorize(),
      winston.format.simple()
    );
  }

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(...formats),
    defaultMeta: { service: 'git-contribution-scorer' },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}]: ${message}${metaStr}`;
          })
        )
      })
    ]
  });
};

export const logger = createLogger();

export function setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
  logger.level = level;
}

export function createChildLogger(metadata: Record<string, any>) {
  return logger.child(metadata);
}