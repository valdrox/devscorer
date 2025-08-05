import dotenv from 'dotenv';
import { Config } from '../types/index.js';
import { ConfigurationError } from './error-handler.js';

dotenv.config();

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
}

function getEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number`);
  }
  return parsed;
}

function getEnvFloat(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number`);
  }
  return parsed;
}

function loadConfig(): Config {
  return {
    anthropicApiKey: getEnvVar('ANTHROPIC_API_KEY'),
    logLevel: getEnvVar('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
    maxConcurrentAnalysis: getEnvNumber('MAX_CONCURRENT_ANALYSIS', 3),
    claudeModel: getEnvVar('CLAUDE_MODEL', 'claude-3-5-sonnet-20241022'),
    maxHintsPerAnalysis: getEnvNumber('MAX_HINTS_PER_ANALYSIS', 10),
    similarityThreshold: getEnvFloat('SIMILARITY_THRESHOLD', 0.85),
  };
}

let _config: Config | null = null;

export const config = new Proxy({} as Config, {
  get(target, prop) {
    if (!_config) {
      _config = loadConfig();
    }
    return _config[prop as keyof Config];
  },
});

export function validateConfig(): void {
  const requiredVars = ['ANTHROPIC_API_KEY'];
  const missing = requiredVars.filter(varName => !process.env[varName]);

  if (missing.length > 0) {
    throw new ConfigurationError(`Missing required environment variables: ${missing.join(', ')}`, {
      missing,
      required: requiredVars,
    });
  }

  // Validate API key format
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && !apiKey.startsWith('sk-ant-')) {
    throw new ConfigurationError('ANTHROPIC_API_KEY must start with "sk-ant-"', {
      provided: `${apiKey?.substring(0, 10)}...`,
    });
  }

  if (!['debug', 'info', 'warn', 'error'].includes(config.logLevel)) {
    throw new ConfigurationError('LOG_LEVEL must be one of: debug, info, warn, error', {
      provided: config.logLevel,
      allowed: ['debug', 'info', 'warn', 'error'],
    });
  }

  if (config.maxConcurrentAnalysis < 1 || config.maxConcurrentAnalysis > 10) {
    throw new ConfigurationError('MAX_CONCURRENT_ANALYSIS must be between 1 and 10', {
      provided: config.maxConcurrentAnalysis,
      min: 1,
      max: 10,
    });
  }

  if (config.maxHintsPerAnalysis < 1 || config.maxHintsPerAnalysis > 20) {
    throw new ConfigurationError('MAX_HINTS_PER_ANALYSIS must be between 1 and 20', {
      provided: config.maxHintsPerAnalysis,
      min: 1,
      max: 20,
    });
  }

  if (config.similarityThreshold < 0 || config.similarityThreshold > 1) {
    throw new ConfigurationError('SIMILARITY_THRESHOLD must be between 0 and 1', {
      provided: config.similarityThreshold,
      min: 0,
      max: 1,
    });
  }
}
