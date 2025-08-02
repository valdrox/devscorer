import dotenv from 'dotenv';
import { Config } from '../types/index.js';

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
    similarityThreshold: getEnvFloat('SIMILARITY_THRESHOLD', 0.85)
  };
}

let _config: Config | null = null;

export const config = new Proxy({} as Config, {
  get(target, prop) {
    if (!_config) {
      _config = loadConfig();
    }
    return _config[prop as keyof Config];
  }
});

export function validateConfig(): void {
  const requiredVars = ['ANTHROPIC_API_KEY'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (!['debug', 'info', 'warn', 'error'].includes(config.logLevel)) {
    throw new Error('LOG_LEVEL must be one of: debug, info, warn, error');
  }

  if (config.maxConcurrentAnalysis < 1 || config.maxConcurrentAnalysis > 10) {
    throw new Error('MAX_CONCURRENT_ANALYSIS must be between 1 and 10');
  }

  if (config.maxHintsPerAnalysis < 1 || config.maxHintsPerAnalysis > 20) {
    throw new Error('MAX_HINTS_PER_ANALYSIS must be between 1 and 20');
  }

  if (config.similarityThreshold < 0 || config.similarityThreshold > 1) {
    throw new Error('SIMILARITY_THRESHOLD must be between 0 and 1');
  }
}