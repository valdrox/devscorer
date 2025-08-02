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
import { ContributionScore, AnalysisReport } from './types/index.js';
import { logger, setLogLevel } from './utils/logger.js';
import { config, validateConfig } from './utils/config.js';
import { tempManager } from './utils/temp-manager.js';

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

      const allRecentMerges = await this.gitAnalyzer.getRecentMerges(days);
      
      // Apply limit if specified
      const recentMerges = limit ? allRecentMerges.slice(0, limit) : allRecentMerges;
      
      if (limit && allRecentMerges.length > limit) {
        logger.info(`Found ${allRecentMerges.length} recent merges, limiting to first ${limit} for analysis`);
      } else {
        logger.info(`Found ${recentMerges.length} recent merges to analyze`);
      }

      if (recentMerges.length === 0) {
        logger.warn('No recent merges found in the specified timeframe');
        return this.scoringEngine.generateDetailedReport(repoUrl, days, []);
      }

      const claudeAvailable = await this.claudeRunner.isClaudeCodeAvailable();
      if (!claudeAvailable) {
        throw new Error('Claude Code SDK is not available. Please install Claude Code: npm install -g @anthropic-ai/claude-code');
      }

      const developerScores: ContributionScore[] = [];
      let processed = 0;

      for (const merge of recentMerges) {
        try {
          logger.info(`Analyzing merge ${++processed}/${recentMerges.length}: ${merge.branch}`);
          logger.info(`🔍 Exploring ${merge.branch} by ${merge.author}`);
          const score = await this.analyzeSingleMerge(merge);
          if (score) {
            developerScores.push(score);
          }
        } catch (error) {
          logger.error(`Failed to analyze merge ${merge.branch}: ${error}`);
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

  private async analyzeSingleMerge(merge: any): Promise<ContributionScore | null> {
    const businessPurpose = await this.businessExtractor.extractBusinessPurpose(merge);
    logger.debug(`Business purpose extracted for ${merge.branch}: ${businessPurpose.summary}`);

    // Create pre-commit repository for Claude Code to work with
    logger.debug(`Creating pre-commit repository for ${merge.branch} (commit: ${merge.commitHash})`);
    let preCommitRepoPath: string;
    
    try {
      preCommitRepoPath = await this.gitAnalyzer.createPreCommitRepository(merge.commitHash);
      logger.debug(`Pre-commit repository created at: ${preCommitRepoPath}`);
    } catch (error) {
      logger.error(`Failed to create pre-commit repository for ${merge.branch}: ${error}`);
      return null;
    }

    let aiMatched = false;
    const hintsGiven: any[] = [];
    let attempts = 0;
    const maxAttempts = config.maxHintsPerAnalysis;

    while (!aiMatched && attempts < maxAttempts) {
      attempts++;
      logger.debug(`Attempt ${attempts} for ${merge.branch}`);

      try {
        const aiResult = await this.claudeRunner.runClaudeCode(
          businessPurpose,
          merge.projectContext,
          preCommitRepoPath,
          hintsGiven
        );

        if (!aiResult.success) {
          logger.warn(`Claude Code failed on attempt ${attempts} for ${merge.branch}: ${aiResult.errors?.join(', ')}`);
          break;
        }

        const comparison = await this.codeComparator.compareFunctionality(
          merge.diff,
          aiResult.code,
          businessPurpose.requirements
        );

        if (comparison.isEquivalent || comparison.similarityScore >= config.similarityThreshold) {
          aiMatched = true;
          logger.debug(`AI matched functionality for ${merge.branch} on attempt ${attempts}`);
        } else {
          const nextHint = await this.codeComparator.generateProgressiveHint(
            comparison.gaps,
            comparison.differences,
            hintsGiven.length + 1,
            hintsGiven
          );
          hintsGiven.push(nextHint);
          logger.debug(`Generated hint ${hintsGiven.length} for ${merge.branch}: ${nextHint.content}`);
        }
      } catch (error) {
        logger.error(`Error during attempt ${attempts} for ${merge.branch}: ${error}`);
        break;
      }

      await this.claudeRunner.cleanup();
    }

    // Clean up the pre-commit repository
    try {
      await fs.remove(preCommitRepoPath);
      logger.debug(`Cleaned up pre-commit repository: ${preCommitRepoPath}`);
    } catch (error) {
      logger.warn(`Failed to cleanup pre-commit repository: ${error}`);
    }

    const complexityScore = this.scoringEngine.calculateComplexityScore(
      merge,
      hintsGiven.length,
      hintsGiven,
      attempts,
      aiMatched
    );

    const contributionScore = this.scoringEngine.createContributionScore(
      merge,
      businessPurpose,
      complexityScore,
      hintsGiven.length,
      hintsGiven,
      attempts
    );

    logger.info(`Score for ${merge.branch}: ${complexityScore} (${hintsGiven.length} hints, ${attempts} attempts)`);
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
          throw new Error('Days must be a number between 1 and 365');
        }

        let limit: number | undefined;
        if (options.limit) {
          limit = parseInt(options.limit, 10);
          if (isNaN(limit) || limit < 1 || limit > 1000) {
            throw new Error('Limit must be a number between 1 and 1000');
          }
        }

        if (!repoUrl.match(/^https?:\/\//)) {
          throw new Error('Repository URL must be a valid HTTP/HTTPS URL');
        }

        console.log(chalk.blue('🔍 Git Contribution Scorer'));
        const limitText = limit ? ` (max ${limit} commits)` : '';
        console.log(chalk.gray(`Analyzing ${repoUrl} for the last ${days} days${limitText}...\n`));

        const scorer = new GitContributionScorer();
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

        await tempManager.cleanupAll();
        
      } catch (error) {
        logger.error(`Analysis failed: ${error}`);
        console.error(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));
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
      score.details.baseComplexity.toString()
    ].join(',');
    lines.push(line);
  }
  
  return lines.join('\n');
}

// ES modules don't have require.main, use import.meta instead
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { GitContributionScorer };