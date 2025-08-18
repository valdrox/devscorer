import chalk from 'chalk';
import fs from 'fs-extra';
import { GitHubIssuesAnalyzer } from '../core/github-issues-analyzer.js';
import { logger, setLogLevel } from '../utils/logger.js';
import { validateConfig } from '../utils/config.js';
import { tempManager } from '../utils/temp-manager.js';
import { ValidationError } from '../utils/error-handler.js';
import { formatGitHubReport, formatGitHubAsCSV } from '../index.js';

export async function githubAnalysisCommand(repoUrl: string, options: any): Promise<void> {
  try {
    if (options.debug) {
      setLogLevel('debug');
      logger.debug('🔧 Debug logging enabled - you should see detailed LLM prompts and responses');
    } else if (options.verbose) {
      setLogLevel('info');
    }

    await validateConfig();
    logger.info('Configuration validated successfully');

    const days = parseInt(options.days, 10);
    if (isNaN(days) || days < 1 || days > 365) {
      throw new ValidationError('Days must be a number between 1 and 365');
    }

    if (!repoUrl.match(/github\.com/)) {
      throw new ValidationError('Repository URL must be a valid GitHub repository URL');
    }

    const analyzer = new GitHubIssuesAnalyzer();

    console.log(chalk.blue('🔍 GitHub Issues & PR Analysis'));
    console.log(chalk.gray(`Analyzing ${repoUrl} for the last ${days} days...\n`));

    const report = await analyzer.analyzeRepository(repoUrl, days);

    if (options.output) {
      await fs.writeJson(options.output, report, { spaces: 2 });
      console.log(chalk.green(`\n✅ Results saved to ${options.output}`));
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else if (options.format === 'csv') {
      console.log(formatGitHubAsCSV(report));
    } else {
      console.log(formatGitHubReport(report));
    }

    await tempManager.cleanupAll();
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));

    logger.error('GitHub analysis failed', error as Error, {
      repository: repoUrl,
      daysAnalyzed: options.days,
    });

    await tempManager.cleanupAll();
    process.exit(1);
  }
}