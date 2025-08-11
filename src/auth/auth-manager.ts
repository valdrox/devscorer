import keytar from 'keytar';
import { password } from '@inquirer/prompts';
import { logger } from '../utils/logger.js';

const SERVICE_NAME = 'devscorer';
const ACCOUNT_NAME = 'anthropic-api-key';

export class AuthManager {

  async login(): Promise<void> {
    try {
      console.log('🔐 Enter your Anthropic API key to authenticate with Claude Code');
      console.log('Get your API key from: https://console.anthropic.com/');

      const apiKey = await password({
        message: 'Anthropic API key:',
        validate: (input: string) => {
          if (!input.trim()) {
            return 'API key cannot be empty';
          }
          if (!input.startsWith('sk-ant-')) {
            return 'API key should start with "sk-ant-"';
          }
          return true;
        },
      });

      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, apiKey);
      console.log('✅ API key stored securely in system keychain');

      logger.info('User authenticated successfully via keychain');
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        console.log('\n❌ Authentication cancelled');
        process.exit(1);
      }

      logger.error(`Login failed: ${error}`);
      throw new Error(`Failed to store API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async logout(): Promise<void> {
    try {
      const deleted = await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);

      if (deleted) {
        console.log('✅ API key removed from system keychain');
        logger.info('User logged out successfully');
      } else {
        console.log('ℹ️ No stored API key found');
      }
    } catch (error) {
      logger.error(`Logout failed: ${error}`);
      throw new Error(`Failed to remove API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getApiKey(): Promise<string> {
    // Priority 1: Check keytar (from 'devscorer login')
    try {
      const keytarKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (keytarKey) {
        logger.debug('Using API key from keychain');
        return keytarKey;
      }
    } catch (error) {
      logger.debug(`Keytar access failed (falling back to env var): ${error}`);
    }

    // Priority 2: Check environment variable (for development/CI)
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) {
      logger.debug('Using API key from environment variable');
      return envKey;
    }

    // Priority 3: Error with helpful message
    throw new Error(
      'No API key found. Options:\n' +
      '  1. Run "devscorer login" to store key securely in keychain\n' +
      '  2. Set ANTHROPIC_API_KEY environment variable',
    );
  }

  async getAuthStatus(): Promise<{
    authenticated: boolean,
    method: 'keychain' | 'environment' | 'none',
    keyPreview?: string
  }> {
    // Check keytar first
    try {
      const keytarKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (keytarKey) {
        return {
          authenticated: true,
          method: 'keychain',
          keyPreview: `sk-ant-${'*'.repeat(keytarKey.length - 10)}${keytarKey.slice(-4)}`,
        };
      }
    } catch (error) {
      logger.debug(`Keytar check failed: ${error}`);
    }

    // Check environment variable
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) {
      return {
        authenticated: true,
        method: 'environment',
        keyPreview: `sk-ant-${'*'.repeat(envKey.length - 10)}${envKey.slice(-4)}`,
      };
    }

    return {
      authenticated: false,
      method: 'none',
    };
  }

  async isLoggedIn(): Promise<boolean> {
    const status = await this.getAuthStatus();
    return status.authenticated;
  }
}

// Export singleton instance
export const authManager = new AuthManager();
