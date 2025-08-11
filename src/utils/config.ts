import dotenv from 'dotenv';
import { Config } from '../types/index.js';
import { ConfigurationError } from './error-handler.js';
import { authManager } from '../auth/auth-manager.js';

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

async function loadConfig(): Promise<Config> {
  const anthropicApiKey = await authManager.getApiKey();

  return {
    anthropicApiKey,
    logLevel: getEnvVar('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
    maxConcurrentAnalysis: getEnvNumber('MAX_CONCURRENT_ANALYSIS', 3),
    claudeModel: getEnvVar('CLAUDE_MODEL', 'claude-3-5-sonnet-20241022'),
    maxHintsPerAnalysis: getEnvNumber('MAX_HINTS_PER_ANALYSIS', 10),
    similarityThreshold: getEnvFloat('SIMILARITY_THRESHOLD', 0.85),
  };
}

let _config: Config | null = null;

// For synchronous access to most config values (not API key)
export const config = new Proxy({} as Omit<Config, 'anthropicApiKey'> & {
  anthropicApiKey?: string
}, {
  get(target, prop) {
    if (prop === 'anthropicApiKey') {
      throw new Error('Use getConfig() or validateConfig() to access API key asynchronously');
    }
    // Load non-API-key config synchronously
    const syncConfig = {
      logLevel: getEnvVar('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
      maxConcurrentAnalysis: getEnvNumber('MAX_CONCURRENT_ANALYSIS', 3),
      claudeModel: getEnvVar('CLAUDE_MODEL', 'claude-3-5-sonnet-20241022'),
      maxHintsPerAnalysis: getEnvNumber('MAX_HINTS_PER_ANALYSIS', 10),
      similarityThreshold: getEnvFloat('SIMILARITY_THRESHOLD', 0.85),
    };
    return syncConfig[prop as keyof typeof syncConfig];
  },
});

// For async access to full config including API key
export async function getConfig(): Promise<Config> {
  if (!_config) {
    _config = await loadConfig();
  }
  return _config;
}

export async function validateConfig(): Promise<void> {
  try {
    // This will throw if no API key is available
    const apiKey = await authManager.getApiKey();

    // Validate API key format
    if (!apiKey.startsWith('sk-ant-')) {
      throw new ConfigurationError('API key must start with "sk-ant-"', {
        provided: `${apiKey.substring(0, 10)}...`,
      });
    }
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    // Re-throw auth errors as config errors
    throw new ConfigurationError(`Authentication error: ${error instanceof Error ? error.message : String(error)}`);
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
