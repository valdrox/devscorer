import keytar from 'keytar';
import { password, confirm } from '@inquirer/prompts';
import open from 'open';
import { Octokit } from 'octokit';
import { ConfigurationError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';

const SERVICE_NAME = 'devscorer';
const ACCOUNT_NAME = 'anthropic-api-key';
const GITHUB_ACCOUNT_NAME = 'github-token';

export class AuthManager {

  async login(): Promise<void> {
    try {
      console.log('🔐 DevScorer Authentication Setup');
      console.log('');

      // Check current auth status
      const anthropicStatus = await this.getAuthStatus();
      const githubStatus = await this.getGitHubAuthStatus();

      let setupAnthropic = !anthropicStatus.authenticated;
      let setupGitHub = !githubStatus.authenticated;

      // If both are already set up, ask what to update
      if (anthropicStatus.authenticated && githubStatus.authenticated) {
        console.log('Both API keys are already configured.');
        const updateAnthropic = await confirm({
          message: 'Update Anthropic API key?',
          default: false,
        });
        const updateGitHub = await confirm({
          message: 'Update GitHub token?',  
          default: false,
        });
        
        if (!updateAnthropic && !updateGitHub) {
          console.log('No changes made.');
          return;
        }
        
        setupAnthropic = updateAnthropic;
        setupGitHub = updateGitHub;
      }

      // Set up Anthropic API key
      if (setupAnthropic) {
        console.log('');
        console.log('📝 Anthropic API Key (required for code analysis)');

        const anthropicUrl = 'https://console.anthropic.com/';
        const openBrowser = await confirm({
          message: 'Open Anthropic Console in browser?',
          default: true,
        });

        if (openBrowser) {
          try {
            console.log('🌐 Opening Anthropic Console in your browser...');
            await open(anthropicUrl);
            console.log('');
            console.log('Instructions:');
            console.log('  1. Sign in to your Anthropic account');
            console.log('  2. Go to API Keys section');
            console.log('  3. Create a new API key');
            console.log('  4. Copy the key and paste it below');
            console.log('');
          } catch (error) {
            console.log('❌ Failed to open browser. Please visit manually:');
            console.log(`  ${anthropicUrl}`);
            console.log('');
          }
        } else {
          console.log('Please visit this URL to get your API key:');
          console.log(`  ${anthropicUrl}`);
          console.log('');
        }

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

        // Validate the API key
        console.log('🔍 Validating Anthropic API key...');
        const validation = await this.validateAnthropicApiKey(apiKey);
        
        if (!validation.valid) {
          throw new ConfigurationError(`Invalid Anthropic API key: ${validation.error}`);
        }

        await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, apiKey);
        console.log('✅ Anthropic API key validated and stored securely');
      }

      // Set up GitHub token
      if (setupGitHub) {
        console.log('');
        console.log('📝 GitHub Token (optional, for GitHub Issues/PR analysis)');

        const setupGitHubToken = await confirm({
          message: 'Set up GitHub token now?',
          default: true,
        });

        if (setupGitHubToken) {
          const tokenUrl = 'https://github.com/settings/personal-access-tokens/new';
          
          const openBrowser = await confirm({
            message: 'Open GitHub fine-grained token creation page in browser?',
            default: true,
          });

          if (openBrowser) {
            try {
              console.log('🌐 Opening GitHub in your browser...');
              await open(tokenUrl);
              console.log('');
              console.log('Instructions for fine-grained personal access token:');
              console.log('  1. Set Token name: "devscorer"');
              console.log('  2. Set Expiration: Choose your preferred duration');
              console.log('  3. Select repositories: Choose specific repos or "All repositories"');
              console.log('  4. Repository permissions:');
              console.log('     - Issues: Read');
              console.log('     - Pull requests: Read');
              console.log('     - Contents: Read (if analyzing private repos)');
              console.log('     - Metadata: Read');
              console.log('  5. Click "Generate token"');
              console.log('  6. Copy the generated token and paste it below');
              console.log('');
            } catch (error) {
              console.log('❌ Failed to open browser. Please visit manually:');
              console.log(`  ${tokenUrl}`);
              console.log('');
            }
          } else {
            console.log('Please visit this URL to create a fine-grained token:');
            console.log(`  ${tokenUrl}`);
            console.log('Required permissions: Issues (Read), Pull requests (Read), Contents (Read), Metadata (Read)');
            console.log('');
          }

          const githubToken = await password({
            message: 'GitHub token:',
            validate: (input: string) => {
              if (!input.trim()) {
                return 'GitHub token cannot be empty';
              }
              if (!input.startsWith('ghp_') && !input.startsWith('github_pat_')) {
                return 'GitHub token should start with "ghp_" (classic) or "github_pat_" (fine-grained)';
              }
              return true;
            },
          });

          // Validate the GitHub token
          console.log('🔍 Validating GitHub token...');
          const validation = await this.validateGitHubToken(githubToken);
          
          if (!validation.valid) {
            throw new ConfigurationError(`Invalid GitHub token: ${validation.error}`);
          }

          await keytar.setPassword(SERVICE_NAME, GITHUB_ACCOUNT_NAME, githubToken);
          console.log(`✅ GitHub token validated and stored securely (user: ${validation.user})`);
        } else {
          console.log('ℹ️ GitHub token setup skipped. You can run "devscorer login" again later.');
        }
      }

      console.log('');
      console.log('🎉 Authentication setup complete!');
      logger.info('User authentication setup completed');
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        console.log('\n❌ Authentication cancelled');
        process.exit(1);
      }

      logger.error(`Login failed: ${error}`);
      throw new ConfigurationError(`Failed to store credentials: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async logout(): Promise<void> {
    try {
      console.log('🔓 DevScorer Logout');
      
      const anthropicDeleted = await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
      const githubDeleted = await keytar.deletePassword(SERVICE_NAME, GITHUB_ACCOUNT_NAME);

      if (anthropicDeleted || githubDeleted) {
        console.log('✅ Credentials removed from system keychain');
        if (anthropicDeleted) {
          logger.info('Anthropic API key removed');
        }
        if (githubDeleted) {
          logger.info('GitHub token removed');
        }
      } else {
        console.log('ℹ️ No stored credentials found');
      }
    } catch (error) {
      logger.error(`Logout failed: ${error}`);
      throw new ConfigurationError(`Failed to remove credentials: ${error instanceof Error ? error.message : String(error)}`);
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
    throw new ConfigurationError(
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

  async loginGitHub(): Promise<void> {
    try {
      console.log('🔐 Enter your GitHub Personal Access Token');
      console.log('Get your token from: https://github.com/settings/tokens');
      console.log('Required scopes: repo (for private repos) or public_repo (for public repos only)');

      const githubToken = await password({
        message: 'GitHub token:',
        validate: (input: string) => {
          if (!input.trim()) {
            return 'GitHub token cannot be empty';
          }
          if (!input.startsWith('ghp_') && !input.startsWith('github_pat_')) {
            return 'GitHub token should start with "ghp_" or "github_pat_"';
          }
          return true;
        },
      });

      await keytar.setPassword(SERVICE_NAME, GITHUB_ACCOUNT_NAME, githubToken);
      console.log('✅ GitHub token stored securely in system keychain');

      logger.info('User authenticated with GitHub successfully via keychain');
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        console.log('\n❌ GitHub authentication cancelled');
        process.exit(1);
      }

      logger.error(`GitHub login failed: ${error}`);
      throw new ConfigurationError(`Failed to store GitHub token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async logoutGitHub(): Promise<void> {
    try {
      const deleted = await keytar.deletePassword(SERVICE_NAME, GITHUB_ACCOUNT_NAME);

      if (deleted) {
        console.log('✅ GitHub token removed from system keychain');
        logger.info('User logged out from GitHub successfully');
      } else {
        console.log('ℹ️ No stored GitHub token found');
      }
    } catch (error) {
      logger.error(`GitHub logout failed: ${error}`);
      throw new ConfigurationError(`Failed to remove GitHub token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getGitHubToken(): Promise<string> {
    // Priority 1: Check keytar (from 'devscorer github-login')
    try {
      const keytarToken = await keytar.getPassword(SERVICE_NAME, GITHUB_ACCOUNT_NAME);
      if (keytarToken) {
        logger.debug('Using GitHub token from keychain');
        return keytarToken;
      }
    } catch (error) {
      logger.debug(`GitHub keytar access failed (falling back to env var): ${error}`);
    }

    // Priority 2: Check environment variable (for development/CI)
    const envToken = process.env.GITHUB_TOKEN;
    if (envToken) {
      logger.debug('Using GitHub token from environment variable');
      return envToken;
    }

    // Priority 3: Error with helpful message
    throw new ConfigurationError(
      'No GitHub token found. Options:\n' +
      '  1. Run "devscorer login" to store token securely in keychain\n' +
      '  2. Set GITHUB_TOKEN environment variable\n' +
      '  3. Get a fine-grained token from:\n' +
      '     https://github.com/settings/personal-access-tokens/new\n' +
      '     Required permissions: Issues (Read), Pull requests (Read), Contents (Read), Metadata (Read)'
    );
  }

  async getGitHubAuthStatus(): Promise<{
    authenticated: boolean,
    method: 'keychain' | 'environment' | 'none',
    tokenPreview?: string
  }> {
    // Check keytar first
    try {
      const keytarToken = await keytar.getPassword(SERVICE_NAME, GITHUB_ACCOUNT_NAME);
      if (keytarToken) {
        return {
          authenticated: true,
          method: 'keychain',
          tokenPreview: keytarToken.length > 12 
            ? `${keytarToken.substring(0, 8)}${'*'.repeat(keytarToken.length - 12)}${keytarToken.slice(-4)}`
            : `${keytarToken.substring(0, 4)}${'*'.repeat(Math.max(0, keytarToken.length - 6))}${keytarToken.slice(-2)}`,
        };
      }
    } catch (error) {
      logger.debug(`GitHub keytar check failed: ${error}`);
    }

    // Check environment variable
    const envToken = process.env.GITHUB_TOKEN;
    if (envToken) {
      return {
        authenticated: true,
        method: 'environment',
        tokenPreview: envToken.length > 12 
          ? `${envToken.substring(0, 8)}${'*'.repeat(envToken.length - 12)}${envToken.slice(-4)}`
          : `${envToken.substring(0, 4)}${'*'.repeat(Math.max(0, envToken.length - 6))}${envToken.slice(-2)}`,
      };
    }

    return {
      authenticated: false,
      method: 'none',
    };
  }

  async isGitHubLoggedIn(): Promise<boolean> {
    const status = await this.getGitHubAuthStatus();
    return status.authenticated;
  }

  private async validateGitHubToken(token: string): Promise<{ valid: boolean, error?: string, user?: string }> {
    try {
      const octokit = new Octokit({ auth: token });
      
      // Test the token by getting user info
      const response = await octokit.rest.users.getAuthenticated();
      
      return {
        valid: true,
        user: response.data.login,
      };
    } catch (error: any) {
      let errorMessage = 'Unknown error';
      
      if (error.status === 401) {
        errorMessage = 'Invalid token or token has expired';
      } else if (error.status === 403) {
        errorMessage = 'Token does not have required permissions';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  private async validateAnthropicApiKey(apiKey: string): Promise<{ valid: boolean, error?: string }> {
    try {
      // Import Anthropic SDK dynamically since it might not be available
      const { Anthropic } = await import('@anthropic-ai/sdk');
      
      const anthropic = new Anthropic({ apiKey });
      
      // Test with a minimal request
      await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      });
      
      return { valid: true };
    } catch (error: any) {
      let errorMessage = 'Unknown error';
      
      if (error.status === 401) {
        errorMessage = 'Invalid API key';
      } else if (error.status === 429) {
        errorMessage = 'Rate limited - API key is valid but try again later';
        // Rate limit doesn't mean invalid key
        return { valid: true };
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        valid: false,
        error: errorMessage,
      };
    }
  }
}

// Export singleton instance
export const authManager = new AuthManager();
