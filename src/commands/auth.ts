import chalk from 'chalk';
import { ClaudeRunner } from '../core/claude-runner.js';
import { validateConfig } from '../utils/config.js';
import { authManager } from '../auth/auth-manager.js';

export async function checkCommand(): Promise<void> {
  try {
    await validateConfig();
    console.log(chalk.green('✅ Configuration is valid'));

    const claudeRunner = new ClaudeRunner();
    const available = await claudeRunner.isClaudeCodeAvailable();

    if (available) {
      console.log(chalk.green('✅ Claude Code SDK is available'));
    } else {
      console.log(chalk.red('❌ Claude Code SDK is not available'));
      console.log(chalk.yellow('Please install Claude Code: npm install -g @anthropic-ai/claude-code'));
    }
  } catch (error) {
    console.error(chalk.red(`❌ Configuration error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

export async function loginCommand(): Promise<void> {
  try {
    await authManager.login();
  } catch (error) {
    console.error(chalk.red(`❌ Login failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

export async function logoutCommand(): Promise<void> {
  try {
    await authManager.logout();
  } catch (error) {
    console.error(chalk.red(`❌ Logout failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

export async function authStatusCommand(): Promise<void> {
  try {
    const anthropicStatus = await authManager.getAuthStatus();
    const githubStatus = await authManager.getGitHubAuthStatus();

    console.log(chalk.blue('🔐 Authentication Status'));
    console.log('');

    console.log(chalk.bold('Anthropic API (for code analysis):'));
    if (anthropicStatus.authenticated) {
      console.log(chalk.green('  ✅ Authenticated'));
      console.log(`     Method: ${anthropicStatus.method}`);
      if (anthropicStatus.keyPreview) {
        console.log(`     API Key: ${anthropicStatus.keyPreview}`);
      }
    } else {
      console.log(chalk.red('  ❌ Not authenticated'));
      console.log('     Run: devscorer login');
    }

    console.log('');
    console.log(chalk.bold('GitHub API (for issues/PR analysis):'));
    if (githubStatus.authenticated) {
      console.log(chalk.green('  ✅ Authenticated'));
      console.log(`     Method: ${githubStatus.method}`);
      if (githubStatus.tokenPreview) {
        console.log(`     Token: ${githubStatus.tokenPreview}`);
      }
    } else {
      console.log(chalk.red('  ❌ Not authenticated'));
      console.log('     Run: devscorer login');
    }
  } catch (error) {
    console.error(chalk.red(`❌ Status check failed: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}