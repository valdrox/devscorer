import chalk from 'chalk';
import fs from 'fs-extra';
import { GitContributionScorer } from '../core/contribution-analyzer.js';
import { ScoringEngine } from '../core/scoring-engine.js';
import { AnalysisReport } from '../types/index.js';
import { logger, setLogLevel } from '../utils/logger.js';
import { validateConfig } from '../utils/config.js';
import { tempManager } from '../utils/temp-manager.js';
import { ErrorHandler, ValidationError } from '../utils/error-handler.js';
import { formatAsCSV } from '../index.js';

export async function reviewCommand(repoUrl: string, options: any): Promise<void> {
  logger.info(JSON.stringify(options));
  try {
    if (options.debug) {
      setLogLevel('debug');
    } else if (options.verbose) {
      setLogLevel('info');
    }

    await validateConfig();
    logger.info('Configuration validated successfully');

    const days = parseInt(options.days || '7', 10);
    if (isNaN(days) || days < 1 || days > 365) {
      throw new ValidationError('Days must be a number between 1 and 365', {
        provided: options.days,
      });
    }

    let limit: number | undefined;
    if (options.limit) {
      limit = parseInt(options.limit, 10);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        throw new ValidationError('Limit must be a number between 1 and 1000', {
          provided: options.limit,
        });
      }
    }

    if (!repoUrl.match(/^https?:\/\//)) {
      throw new ValidationError('Repository URL must be a valid HTTP/HTTPS URL', {
        provided: repoUrl,
      });
    }

    const concurrency = options.parallel ? parseInt(options.concurrency, 10) : 1;
    
    // Validate concurrency limits for resource management
    if (concurrency > 10) {
      console.log(chalk.yellow('⚠️ Warning: High concurrency (>10) may cause memory issues. Consider reducing --concurrency.'));
    }
    
    if (options.parallel) {
      logger.info(`🚀 Parallel mode enabled with ${concurrency} concurrent operations`);
    }
    
    const scorer = new GitContributionScorer();

    if (options.commit) {
      // Single commit analysis
      const commitHash = options.commit;
      console.log(chalk.blue('🔍 Git Contribution Scorer'));
      console.log(chalk.gray(`Analyzing commit ${commitHash} from ${repoUrl}...\n`));

      const score = await scorer.analyzeCommit(repoUrl, commitHash);

      if (!score) {
        console.log(chalk.yellow('⚠️ No analysis result for this commit'));
        return;
      }

      // Create a single-commit report
      const report: AnalysisReport = {
        repositoryUrl: repoUrl,
        analysisDate: new Date(),
        daysCovered: 0,
        totalContributions: 1,
        developerScores: [score],
        summary: {
          topPerformers: [score.developer],
          averageScore: score.score,
          complexityDistribution: { [score.score.toString()]: 1 },
        },
      };

      if (options.output) {
        await fs.writeJson(options.output, report, { spaces: 2 });
        console.log(chalk.green(`\n✅ Results saved to ${options.output}`));
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(report, null, 2));
      } else if (options.format === 'csv') {
        console.log(formatAsCSV(report));
      } else {
        console.log(new ScoringEngine().formatReportForConsole(report));
      }
    } else {
      // Multi-commit analysis (existing behavior)
      const limitText = limit ? ` (max ${limit} commits)` : '';
      const parallelMode = options.parallel ? ` (parallel mode: ${concurrency} concurrent)` : '';
      console.log(chalk.blue('🔍 Git Contribution Scorer'));
      console.log(chalk.gray(`Analyzing ${repoUrl} for the last ${days} days${limitText}${parallelMode}...\n`));

      const report = await scorer.analyzeContributions(repoUrl, days, limit, { 
        parallel: options.parallel, 
        concurrency 
      });

      if (options.output) {
        await fs.writeJson(options.output, report, { spaces: 2 });
        console.log(chalk.green(`\n✅ Results saved to ${options.output}`));
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(report, null, 2));
      } else if (options.format === 'csv') {
        console.log(formatAsCSV(report));
      } else {
        console.log(new ScoringEngine().formatReportForConsole(report));
      }
    }

    await tempManager.cleanupAll();
  } catch (error) {
    const appError = ErrorHandler.handle(error, 'main-analysis');
    const userMessage = ErrorHandler.formatForUser(appError);

    console.error(chalk.red(`❌ Error: ${userMessage}`));

    // Log additional context for debugging
    logger.error('Analysis failed', error as Error, {
      repository: repoUrl,
      daysAnalyzed: options.days,
      limitApplied: options.limit,
      errorContext: ErrorHandler.extractContext(appError),
    });

    await tempManager.cleanupAll();
    process.exit(1);
  }
}