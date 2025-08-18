import chalk from 'chalk';
import { DeveloperAnalyzer } from '../core/developer-analyzer.js';
import { DeveloperScope, DiscoveryFilters } from '../types/developer-types.js';
import { logger, setLogLevel } from '../utils/logger.js';
import { validateConfig } from '../utils/config.js';
import { tempManager } from '../utils/temp-manager.js';
import { ValidationError } from '../utils/error-handler.js';
import { GitHubDiscoveryService } from '../services/github-discovery.js';
import { formatDeveloperAnalysis } from '../index.js';

export async function evaluateCommand(username: string, options: any): Promise<void> {
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

    // Validate username format
    if (!username.match(/^[a-zA-Z0-9-]+$/)) {
      throw new ValidationError('Invalid GitHub username format');
    }

    // Build scope and filters
    const scope: DeveloperScope = {
      username,
      days,
    };

    const filters: DiscoveryFilters = {
      minActivity: options.minActivity ? parseInt(options.minActivity, 10) : 1,
    };

    if (options.org) {
      filters.organizations = [options.org];
    }

    if (options.repos) {
      filters.repositories = options.repos.split(',').map((r: string) => r.trim());
    }

    if (options.orgRepos) {
      filters.orgRepositories = options.orgRepos;
    }

    // Step 1: Discovery phase (if unscoped)
    if (!filters.repositories && !filters.organizations && !filters.orgRepositories) {
      console.log(chalk.cyan('🔍 Developer Analysis - Discovery Phase'));
      console.log(`Discovering activity for ${username}...`);
      console.log();

      const discoveryService = new GitHubDiscoveryService();
      const discovery = await discoveryService.discoverUserActivity(scope, filters);

      // Show discovered activity summary
      console.log(chalk.green(`Found activity for '${username}' in last period:`));
      console.log();
      console.log(chalk.cyan('📊 Activity Summary:'));
      console.log(`• ${discovery.repositories.length} repositories with activity`);
      console.log(`• ${discovery.totalCommits} commits`);
      console.log(`• ${discovery.totalIssues} issues created/commented`);
      console.log(`• ${discovery.totalPullRequests} pull requests`);
      console.log(`• ${discovery.totalReviews} code reviews`);
      console.log(`• ${discovery.totalComments} comments`);
      console.log();

      const totalActivities = discovery.totalCommits + discovery.totalIssues + 
                             discovery.totalPullRequests + discovery.totalReviews + 
                             discovery.totalComments;

      if (totalActivities === 0) {
        console.log(chalk.yellow('⚠️ No activity found for this user in the specified time period.'));
        console.log('Consider:');
        console.log('• Increasing the number of days with --days option');
        console.log('• Checking if the username is correct');
        console.log('• Verifying the user has public activity on GitHub');
        return;
      }

      // Estimate cost and time
      const estimatedEvaluations = Math.min(discovery.repositories.length, 3); // We analyze top 3 repos
      const estimatedCost = estimatedEvaluations * 0.15; // Rough estimate
      const estimatedTime = estimatedEvaluations * 1; // Minutes per repo

      console.log(chalk.cyan('📈 Analysis Scope:'));
      console.log(`• Estimated ${estimatedEvaluations} LLM evaluations needed`);
      console.log(`• Estimated cost: ~$${estimatedCost.toFixed(2)}`);
      console.log(`• Estimated time: ~${estimatedTime} minutes`);
      console.log();

      // Show organizations
      const organizations = [...new Set(discovery.repositories.map(r => r.fullName.split('/')[0]))];
      if (organizations.length > 0) {
        console.log(chalk.cyan('🏢 Organizations:'), organizations.join(', '));
        console.log();
      }

      // Show top repositories
      const topRepos = discovery.repositories
        .sort((a, b) => (b.commits + b.issues + b.pullRequests + b.reviews + b.comments) - 
                       (a.commits + a.issues + a.pullRequests + a.reviews + a.comments))
        .slice(0, 5);

      if (topRepos.length > 0) {
        console.log(chalk.cyan('Top active repositories:'));
        topRepos.forEach(repo => {
          const activities = repo.commits + repo.issues + repo.pullRequests + repo.reviews + repo.comments;
          console.log(`• ${repo.fullName} (${activities} activities)`);
        });
        console.log();
      }

      // Confirm before proceeding
      const { confirm } = await import('@inquirer/prompts');
      const shouldProceed = await confirm({
        message: 'Proceed with analysis?',
        default: true,
      });

      if (!shouldProceed) {
        console.log(chalk.yellow('Analysis cancelled by user.'));
        return;
      }
    }

    // Step 2: Comprehensive Analysis
    console.log(chalk.cyan('🚀 Developer Analysis - Processing Phase'));
    const mode = options.parallel ? `parallel (${options.concurrency || 5} concurrent)` : 'sequential';
    console.log(`Analyzing ${username} with comprehensive evaluation (${mode} mode)...`);
    console.log();

    const parallelOptions = {
      parallel: options.parallel || false,
      concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 5,
    };

    const analyzer = new DeveloperAnalyzer();
    const analysis = await analyzer.analyzeDeveloper(scope, filters, parallelOptions);

    // Format and display results
    if (options.format === 'json') {
      if (options.output) {
        const fs = await import('fs-extra');
        await fs.writeJson(options.output, analysis, { spaces: 2 });
        console.log(chalk.green(`✅ Results saved to ${options.output}`));
      } else {
        console.log(JSON.stringify(analysis, null, 2));
      }
    } else {
      console.log(formatDeveloperAnalysis(analysis));
    }

    await tempManager.cleanupAll();
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));

    logger.error('Developer analysis failed', error as Error, {
      username,
      daysAnalyzed: options.days,
    });

    await tempManager.cleanupAll();
    process.exit(1);
  }
}