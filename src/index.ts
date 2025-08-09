#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { GitAnalyzer } from './core/git-analyzer.js';
import { BusinessExtractor } from './core/business-extractor.js';
import { ClaudeRunner } from './core/claude-runner.js';
import { CodeComparator } from './core/code-comparator.js';
import { ScoringEngine } from './core/scoring-engine.js';
import { ContributionScore, AnalysisReport, GitContribution, Hint } from './types/index.js';
import { logger, setLogLevel } from './utils/logger.js';
import { config, validateConfig } from './utils/config.js';
import { tempManager } from './utils/temp-manager.js';
import { ErrorHandler, ValidationError, ConfigurationError } from './utils/error-handler.js';

class GitContributionScorer {
  private gitAnalyzer: GitAnalyzer;
  private businessExtractor: BusinessExtractor;
  private claudeRunner: ClaudeRunner;
  private codeComparator: CodeComparator;
  private scoringEngine: ScoringEngine;

  constructor() {
    this.gitAnalyzer = new GitAnalyzer();
    this.businessExtractor = new BusinessExtractor();
    this.claudeRunner = new ClaudeRunner();
    this.codeComparator = new CodeComparator();
    this.scoringEngine = new ScoringEngine();
  }

  async analyzeContributions(repoUrl: string, days: number = 7, limit?: number): Promise<AnalysisReport> {
    const limitText = limit ? ` (max ${limit} commits)` : '';
    logger.info(`Starting analysis of ${repoUrl} for the last ${days} days${limitText}`);

    try {
      const repoPath = await this.gitAnalyzer.cloneRepository(repoUrl);
      logger.info(`Repository cloned successfully`);

      const allRecentContributions = await this.gitAnalyzer.getRecentContributions(days);

      // Apply limit if specified
      const contributionsToAnalyze = limit ? allRecentContributions.slice(0, limit) : allRecentContributions;

      if (limit && allRecentContributions.length > limit) {
        logger.info(
          `Found ${allRecentContributions.length} recent contributions, limiting to first ${limit} for analysis`
        );
      } else {
        logger.info(`Found ${contributionsToAnalyze.length} recent contributions to analyze`);
      }

      if (contributionsToAnalyze.length === 0) {
        logger.warn('No recent contributions found in the specified timeframe');
        return this.scoringEngine.generateDetailedReport(repoUrl, days, []);
      }

      const claudeAvailable = await this.claudeRunner.isClaudeCodeAvailable();
      if (!claudeAvailable) {
        throw new Error(
          'Claude Code SDK is not available. Please install Claude Code: npm install -g @anthropic-ai/claude-code'
        );
      }

      const developerScores: ContributionScore[] = [];
      let processed = 0;

      for (const contribution of contributionsToAnalyze) {
        try {
          logger.info(`Analyzing contribution ${++processed}/${contributionsToAnalyze.length}: ${contribution.branch}`);
          logger.info(`🔍 Exploring ${contribution.branch} by ${contribution.author}`);
          const score = await this.analyzeContribution(contribution);
          if (score) {
            developerScores.push(score);
          }
        } catch (error) {
          logger.error(`Failed to analyze contribution ${contribution.branch}: ${error}`);
        }
      }

      await this.gitAnalyzer.cleanup();
      logger.info(`Analysis completed. Processed ${developerScores.length} contributions.`);

      return this.scoringEngine.generateDetailedReport(repoUrl, days, developerScores);
    } catch (error) {
      await this.gitAnalyzer.cleanup();
      throw error;
    }
  }

  async analyzeCommit(repoUrl: string, commitHash: string): Promise<ContributionScore | null> {
    logger.info(`Starting analysis of commit ${commitHash} from ${repoUrl}`);

    try {
      const repoPath = await this.gitAnalyzer.cloneRepository(repoUrl);
      logger.info(`Repository cloned successfully`);

      const claudeAvailable = await this.claudeRunner.isClaudeCodeAvailable();
      if (!claudeAvailable) {
        throw new Error(
          'Claude Code SDK is not available. Please install Claude Code: npm install -g @anthropic-ai/claude-code'
        );
      }

      const contribution = await this.gitAnalyzer.getCommitContribution(commitHash);
      logger.info(`Analyzing commit: ${contribution.branch} by ${contribution.author}`);

      const score = await this.analyzeContribution(contribution);
      
      await this.gitAnalyzer.cleanup();
      logger.info(`Analysis completed for commit ${commitHash}`);

      return score;
    } catch (error) {
      await this.gitAnalyzer.cleanup();
      throw error;
    }
  }

  private async analyzeContribution(contribution: GitContribution): Promise<ContributionScore | null> {
    const businessPurpose = await this.businessExtractor.extractBusinessPurpose(contribution);
    logger.debug(`Business purpose extracted for ${contribution.branch}: ${businessPurpose.summary}`);

    // Create pre-commit repository for Claude Code to work with
    logger.debug(`Creating pre-commit repository for ${contribution.branch} (commit: ${contribution.commitHash})`);
    let preCommitRepoPath: string;

    try {
      preCommitRepoPath = await this.gitAnalyzer.createPreCommitRepository(contribution.commitHash);
      logger.debug(`Pre-commit repository created at: ${preCommitRepoPath}`);
    } catch (error) {
      logger.error(`Failed to create pre-commit repository for ${contribution.branch}: ${error}`);
      return null;
    }

    let functionalityMatched = false;
    const hintsGiven: Hint[] = [];
    let attempts = 0;
    const maxAttempts = config.maxHintsPerAnalysis;

    while (!functionalityMatched && attempts < maxAttempts) {
      attempts++;
      logger.debug(`Attempt ${attempts} for ${contribution.branch}`);

      try {
        const aiResult = await this.claudeRunner.runClaudeCode(
          businessPurpose,
          contribution.projectContext,
          preCommitRepoPath,
          contribution.diff,
          hintsGiven
        );

        if (!aiResult.success) {
          logger.warn(
            `Claude Code failed on attempt ${attempts} for ${contribution.branch}: ${aiResult.errors?.join(', ')}`
          );
          break;
        }

        const comparison = await this.codeComparator.compareFunctionality(
          contribution.diff,
          aiResult.code,
          businessPurpose.requirements
        );

        if (comparison.isEquivalent || comparison.similarityScore >= config.similarityThreshold) {
          functionalityMatched = true;
          logger.debug(
            `✅ Claude Code matched functionality for ${contribution.branch} on attempt ${attempts} (score: ${comparison.similarityScore}, threshold: ${config.similarityThreshold})`
          );
        } else {
          logger.debug(
            `❌ Claude Code didn't match yet for ${contribution.branch} (score: ${comparison.similarityScore}, threshold: ${config.similarityThreshold})`
          );
          const nextHint = await this.codeComparator.generateProgressiveHint(
            comparison.gaps,
            comparison.differences,
            hintsGiven.length + 1,
            hintsGiven
          );
          hintsGiven.push(nextHint);
          logger.debug(`💡 Generated hint ${hintsGiven.length} for ${contribution.branch}: ${nextHint.content}`);
        }
      } catch (error) {
        logger.error(`Error during attempt ${attempts} for ${contribution.branch}: ${error}`);
        break;
      }
    }

    // Clean up Claude Code session after all attempts are complete
    await this.claudeRunner.cleanup();

    // Clean up the pre-commit repository
    try {
      await fs.remove(preCommitRepoPath);
      logger.debug(`Cleaned up pre-commit repository: ${preCommitRepoPath}`);
    } catch (error) {
      logger.warn(`Failed to cleanup pre-commit repository: ${error}`);
    }

    const complexityScore = this.scoringEngine.calculateComplexityScore(
      contribution,
      hintsGiven.length,
      hintsGiven,
      attempts,
      functionalityMatched
    );

    const contributionScore = this.scoringEngine.createContributionScore(
      contribution,
      businessPurpose,
      complexityScore,
      hintsGiven.length,
      hintsGiven,
      attempts
    );

    logger.info(
      `Score for ${contribution.branch}: ${complexityScore} (${hintsGiven.length} hints, ${attempts} attempts)`
    );
    return contributionScore;
  }
}

async function main() {
  const program = new Command();

  program
    .name('git-scorer')
    .description('Analyze git contributions complexity using AI')
    .version('1.0.0')
    .argument('<repo-url>', 'GitHub repository URL')
    .option('-d, --days <number>', 'Number of days to analyze', '7')
    .option('-l, --limit <number>', 'Maximum number of commits to analyze (for faster testing)')
    .option('-c, --commit <hash>', 'Analyze a specific commit by hash')
    .option('-o, --output <file>', 'Output file for results (JSON format)')
    .option('--format <type>', 'Output format (table|json|csv)', 'table')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .action(async (repoUrl: string, options: any) => {
      try {
        if (options.debug) {
          setLogLevel('debug');
        } else if (options.verbose) {
          setLogLevel('info');
        }

        validateConfig();
        logger.info('Configuration validated successfully');

        const days = parseInt(options.days, 10);
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
          console.log(chalk.blue('🔍 Git Contribution Scorer'));
          console.log(chalk.gray(`Analyzing ${repoUrl} for the last ${days} days${limitText}...\n`));

          const report = await scorer.analyzeContributions(repoUrl, days, limit);

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
    });

  program
    .command('check')
    .description('Check if Claude Code is available and configured correctly')
    .action(async () => {
      try {
        validateConfig();
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
    });

  program.parse();
}

function formatAsCSV(report: AnalysisReport): string {
  const lines: string[] = [];
  lines.push('Developer,Date,Branch,Description,Score,Hints Needed,Attempts,Base Complexity');

  for (const score of report.developerScores) {
    const line = [
      score.developer,
      score.date.toISOString().split('T')[0],
      `"${score.branch}"`,
      `"${score.description}"`,
      score.score.toString(),
      score.hintsNeeded.toString(),
      score.details.attempts.toString(),
      score.details.baseComplexity.toString(),
    ].join(',');
    lines.push(line);
  }

  return lines.join('\n');
}

// ES modules don't have require.main, use import.meta instead
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { GitContributionScorer };
