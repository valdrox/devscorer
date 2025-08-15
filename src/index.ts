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
import { GitHubIssuesAnalyzer } from './core/github-issues-analyzer.js';
import { DeveloperAnalyzer } from './core/developer-analyzer.js';
import { GitHubDiscoveryService } from './services/github-discovery.js';
import { ContributionScore, AnalysisReport, GitContribution, Hint } from './types/index.js';
import { DeveloperScope, DiscoveryFilters } from './types/developer-types.js';
import { logger, setLogLevel } from './utils/logger.js';
import { config, validateConfig } from './utils/config.js';
import { tempManager } from './utils/temp-manager.js';
import { ErrorHandler, ValidationError, ConfigurationError } from './utils/error-handler.js';
import { authManager } from './auth/auth-manager.js';

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

  private async categorizeContribution(contribution: GitContribution): Promise<{
    type: 'documentation' | 'logic' | 'mixed';
    documentationComplexity?: 'small' | 'medium' | 'heavy';
  }> {
    const categorizationPrompt = `
Analyze this git diff and categorize the contribution:

DIFF:
${contribution.diff}

Categorize this contribution as:
1. "documentation" - Only documentation changes (README, comments, docs, config files with no logic impact)
2. "logic" - Only application/business logic changes (algorithms, functions, core functionality) 
3. "mixed" - Both documentation and logic changes

If "documentation" or "mixed", also rate the documentation complexity:
- "small": Minor updates, typos, small additions
- "medium": Substantial doc updates, new sections, significant improvements  
- "heavy": Major documentation overhauls, comprehensive new documentation

Respond with JSON: {"type": "documentation|logic|mixed", "documentationComplexity": "small|medium|heavy"}
`;

    try {
      // For now, use a simple heuristic. Later we can integrate with an LLM service
      const diff = contribution.diff.toLowerCase();

      // Check for logic file extensions and patterns
      const hasLogicChanges =
        diff.match(/\.(js|ts|py|java|cpp|go|rs|c|h|php|rb|swift|kt|scala|elm|hs)[\s\n]/) ||
        diff.includes('function ') ||
        diff.includes('class ') ||
        diff.includes('import ') ||
        diff.includes('def ') ||
        diff.includes('const ') ||
        diff.includes('let ') ||
        diff.includes('var ') ||
        diff.includes('if (') ||
        diff.includes('for (') ||
        diff.includes('=>') ||
        diff.includes('return ');

      // Check for documentation file patterns
      const hasDocChanges =
        diff.includes('readme') ||
        diff.match(/\.(md|txt|rst|adoc)[\s\n]/) ||
        diff.includes('changelog') ||
        diff.includes('license') ||
        diff.includes('contributing') ||
        diff.includes('code_of_conduct') ||
        diff.includes('//') ||
        diff.includes('/*') ||
        diff.includes('*') ||
        diff.includes('package.json') ||
        diff.includes('.yml') ||
        diff.includes('.yaml') ||
        diff.includes('.toml') ||
        diff.includes('.ini');

      // Simple line count heuristic for doc complexity
      const linesChanged = contribution.linesChanged;
      let documentationComplexity: 'small' | 'medium' | 'heavy' = 'small';
      if (linesChanged > 50) documentationComplexity = 'heavy';
      else if (linesChanged > 15) documentationComplexity = 'medium';

      logger.debug(
        `Categorization analysis: hasLogicChanges=${hasLogicChanges}, hasDocChanges=${hasDocChanges}, linesChanged=${linesChanged}`
      );

      if (hasLogicChanges && hasDocChanges) {
        return { type: 'mixed', documentationComplexity };
      } else if (hasDocChanges && !hasLogicChanges) {
        return { type: 'documentation', documentationComplexity };
      } else {
        return { type: 'logic' };
      }
    } catch (error) {
      logger.warn(`Failed to categorize contribution ${contribution.branch}: ${error}`);
      return { type: 'logic' }; // Default to logic analysis if categorization fails
    }
  }

  private async scoreDocumentationOnly(
    contribution: GitContribution,
    documentationComplexity: 'small' | 'medium' | 'heavy'
  ): Promise<ContributionScore> {
    // Base scores for documentation complexity
    const baseScores = {
      small: 8,
      medium: 15,
      heavy: 25,
    };

    const baseScore = baseScores[documentationComplexity];

    // Add some variability based on lines changed and files modified
    const linesBonus = Math.min(contribution.linesChanged * 0.1, 10);
    const filesBonus = Math.min(contribution.commits.length * 2, 8);

    const finalScore = Math.round(baseScore + linesBonus + filesBonus);

    logger.info(`Documentation-only contribution scored: ${finalScore} (${documentationComplexity} complexity)`);

    return this.scoringEngine.createContributionScore(
      contribution,
      {
        summary: `Documentation update: ${documentationComplexity} complexity`,
        requirements: [`Update documentation with ${documentationComplexity} level changes`],
        technicalContext: 'Documentation-only contribution, scored based on complexity and scope',
      },
      finalScore,
      0, // No hints needed for doc-only
      [], // No hints
      1 // Single "attempt"
    );
  }

  private async analyzeContribution(contribution: GitContribution): Promise<ContributionScore | null> {
    const businessPurpose = await this.businessExtractor.extractBusinessPurpose(contribution);
    logger.debug(`Business purpose extracted for ${contribution.branch}: ${businessPurpose.summary}`);

    // Categorize the contribution to determine analysis approach
    const category = await this.categorizeContribution(contribution);
    logger.debug(
      `Contribution categorized as: ${category.type} ${category.documentationComplexity ? `(${category.documentationComplexity} docs)` : ''}`
    );

    // Handle documentation-only contributions with direct scoring
    if (category.type === 'documentation' && category.documentationComplexity) {
      return await this.scoreDocumentationOnly(contribution, category.documentationComplexity);
    }

    // For logic and mixed contributions, proceed with Claude Code analysis
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

    // Store category for later use in scoring
    const contributionCategory = category;

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

        const technicalComparison = await this.codeComparator.compareTechnicalContributions(
          contribution.diff,
          aiResult.code,
          businessPurpose.requirements
        );

        if (technicalComparison.isEquivalent || technicalComparison.similarityScore >= config.similarityThreshold) {
          functionalityMatched = true;
          logger.debug(
            `✅ Claude Code matched functionality for ${contribution.branch} on attempt ${attempts} (score: ${technicalComparison.similarityScore}, threshold: ${config.similarityThreshold})`
          );
        } else {
          logger.debug(
            `❌ Claude Code didn't match yet for ${contribution.branch} (score: ${technicalComparison.similarityScore}, threshold: ${config.similarityThreshold})`
          );

          // Only generate hint if human contribution is technically superior
          const humanTechnicalFactors = technicalComparison.factorsThatMakeABetter;
          const nextHint = await this.codeComparator.generateTechnicalHint(
            humanTechnicalFactors,
            hintsGiven.length + 1,
            hintsGiven
          );

          if (nextHint === null) {
            // AI implementation is equal or better - stop trying
            logger.debug(
              `🤖 AI implementation is technically equal or superior for ${contribution.branch} - stopping hint generation`
            );
            break;
          }

          hintsGiven.push(nextHint);
          logger.debug(
            `💡 Generated technical hint ${hintsGiven.length} for ${contribution.branch}: ${nextHint.content}`
          );
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

    let complexityScore = this.scoringEngine.calculateComplexityScore(
      contribution,
      hintsGiven.length,
      hintsGiven,
      attempts,
      functionalityMatched
    );

    // Add documentation complexity bonus for mixed contributions
    if (contributionCategory.type === 'mixed' && contributionCategory.documentationComplexity) {
      const docBonus = {
        small: 3,
        medium: 7,
        heavy: 12,
      };
      const bonus = docBonus[contributionCategory.documentationComplexity];
      complexityScore += bonus;
      logger.debug(
        `Added ${bonus} points for ${contributionCategory.documentationComplexity} documentation complexity (mixed contribution)`
      );
    }

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

  program.name('devscorer').description('Dev performance evaluator').version('1.0.0');

  program
    .command('evaluate')
    .description('Comprehensive developer evaluation (combines code + social analysis)')
    .argument('<username>', 'GitHub username to evaluate')
    .option('-d, --days <number>', 'Number of days to analyze', '30')
    .option('--org <organization>', 'Limit analysis to specific organization')
    .option('--repos <repositories>', 'Limit analysis to specific repositories (comma-separated)')
    .option('--org-repos <organization>', 'Analyze only repos owned by this organization')
    .option('--min-activity <number>', 'Minimum activities required to include a repository', '2')
    .option('-o, --output <file>', 'Output file for results (JSON format)')
    .option('--format <type>', 'Output format (table|json)', 'table')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .action(async (username: string, options: any) => {
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
          throw new Error('Days must be a number between 1 and 365');
        }

        // Validate username format
        if (!username.match(/^[a-zA-Z0-9-]+$/)) {
          throw new Error('Invalid GitHub username format');
        }

        // Build scope and filters
        const scope: DeveloperScope = {
          username,
          days,
        };

        const filters: DiscoveryFilters = {
          minActivity: options.minActivity ? parseInt(options.minActivity, 10) : 2,
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
        const isUnscoped = !options.org && !options.repos && !options.orgRepos;
        
        if (isUnscoped) {
          console.log(chalk.blue('🔍 Developer Analysis - Discovery Phase'));
          console.log(chalk.gray(`Discovering activity for ${username}...\n`));

          const discoveryService = new GitHubDiscoveryService();
          const discovery = await discoveryService.discoverUserActivity(scope, filters);
          const confirmationPrompt = discoveryService.generateConfirmationPrompt(discovery);

          console.log(confirmationPrompt.message);
          console.log('');

          // Ask for confirmation
          const { confirm } = await import('@inquirer/prompts');
          const shouldProceed = await confirm({
            message: 'Proceed with analysis?',
            default: false,
          });

          if (!shouldProceed) {
            console.log(chalk.yellow('Analysis cancelled by user.'));
            console.log('');
            console.log(chalk.gray('💡 Tip: Use --org, --repos, or --org-repos to scope your analysis:'));
            console.log(chalk.gray('  devscorer evaluate ' + username + ' --org microsoft'));
            console.log(chalk.gray('  devscorer evaluate ' + username + ' --repos microsoft/vscode,microsoft/typescript'));
            return;
          }
        }

        // Step 2: Full analysis
        console.log(chalk.blue('🚀 Developer Analysis - Processing Phase'));
        console.log(chalk.gray(`Analyzing ${username} with comprehensive evaluation...\n`));

        const analyzer = new DeveloperAnalyzer();
        const analysis = await analyzer.analyzeDeveloper(scope, filters);

        // Step 3: Display results
        if (options.output) {
          await fs.writeJson(options.output, analysis, { spaces: 2 });
          console.log(chalk.green(`\n✅ Results saved to ${options.output}`));
        }

        if (options.format === 'json') {
          console.log(JSON.stringify(analysis, null, 2));
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
    });

  program
    .command('review')
    .description('Analyze git contributions complexity using AI')
    .argument('<repo-url>', 'GitHub repository URL')
    .option('-l, --limit <number>', 'Maximum number of commits to analyze (for faster testing)')
    .option('-c, --commit <hash>', 'Analyze a specific commit by hash')
    .option('-o, --output <file>', 'Output file for results (JSON format)')
    .option('--format <type>', 'Output format (table|json|csv)', 'table')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .action(async (repoUrl: string, options: any) => {
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
    });

  program
    .command('login')
    .description('Store API keys securely (Anthropic API key + GitHub token)')
    .action(async () => {
      try {
        await authManager.login();
      } catch (error) {
        console.error(chalk.red(`❌ Login failed: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });

  program
    .command('logout')
    .description('Remove stored API keys from system keychain')
    .action(async () => {
      try {
        await authManager.logout();
      } catch (error) {
        console.error(chalk.red(`❌ Logout failed: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });

  program
    .command('auth-status')
    .description('Show authentication status')
    .action(async () => {
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
    });

  program
    .command('github-analysis')
    .description('Analyze developer performance through GitHub issues, PRs, and reviews')
    .argument('<repo-url>', 'GitHub repository URL')
    .option('-d, --days <number>', 'Number of days to analyze', '7')
    .option('-o, --output <file>', 'Output file for results (JSON format)')
    .option('--format <type>', 'Output format (table|json|csv)', 'table')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .action(async (repoUrl: string, options: any) => {
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
          throw new Error('Days must be a number between 1 and 365');
        }

        if (!repoUrl.match(/github\.com/)) {
          throw new Error('Repository URL must be a valid GitHub repository URL');
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

function formatGitHubReport(report: any): string {
  const lines: string[] = [];

  lines.push('================================================================================');
  lines.push('GITHUB ISSUES & PR ANALYSIS REPORT');
  lines.push('================================================================================');
  lines.push(`Repository: ${report.repositoryUrl}`);
  lines.push(`Analysis Date: ${report.analysisDate.toISOString().split('T')[0]}`);
  lines.push(`Period: Last ${report.daysCovered} days`);
  lines.push(`Developers Analyzed: ${report.developerAnalyses.length}`);
  lines.push(`Average Score: ${report.summary.averageScore}/10`);
  lines.push('');

  if (report.summary.topPerformers.length > 0) {
    lines.push('TOP PERFORMERS:');
    lines.push('----------------------------------------');
    report.summary.topPerformers.forEach((performer: string, index: number) => {
      lines.push(`${index + 1}. ${performer}`);
    });
    lines.push('');
  }

  lines.push('TEAM INSIGHTS:');
  lines.push('----------------------------------------');
  report.summary.teamInsights.forEach((insight: string) => {
    lines.push(`• ${insight}`);
  });
  lines.push('');

  lines.push('INDIVIDUAL DEVELOPER ANALYSIS:');
  lines.push('--------------------------------------------------------------------------------');
  lines.push('Score | Developer      | Tech | Comm | Collab | Delivery | Strengths & Suggestions');
  lines.push('--------------------------------------------------------------------------------');

  for (const analysis of report.developerAnalyses) {
    const scoreStr = analysis.overallScore.toFixed(1).padStart(5);
    const developerStr = analysis.developer.padEnd(14).slice(0, 14);
    const techStr = analysis.technicalQuality.toString().padStart(4);
    const commStr = analysis.communication.toString().padStart(4);
    const collabStr = analysis.collaboration.toString().padStart(6);
    const deliveryStr = analysis.delivery.toString().padStart(8);

    lines.push(`${scoreStr} | ${developerStr} | ${techStr} | ${commStr} | ${collabStr} | ${deliveryStr} |`);

    // Add examples and suggestions
    if (analysis.examples.length > 0) {
      lines.push(`      Examples: ${analysis.examples[0]}`);
    }
    if (analysis.suggestions.length > 0) {
      lines.push(`      Suggestion: ${analysis.suggestions[0]}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatGitHubAsCSV(report: any): string {
  const lines: string[] = [];
  lines.push(
    'Developer,Overall Score,Technical Quality,Communication,Collaboration,Delivery,Top Example,Top Suggestion'
  );

  for (const analysis of report.developerAnalyses) {
    const line = [
      analysis.developer,
      analysis.overallScore.toString(),
      analysis.technicalQuality.toString(),
      analysis.communication.toString(),
      analysis.collaboration.toString(),
      analysis.delivery.toString(),
      `"${analysis.examples[0] || 'None'}"`,
      `"${analysis.suggestions[0] || 'None'}"`,
    ].join(',');
    lines.push(line);
  }

  return lines.join('\n');
}

function formatDeveloperAnalysis(analysis: any): string {
  const lines: string[] = [];
  
  lines.push('================================================================================');
  lines.push('COMPREHENSIVE DEVELOPER ANALYSIS REPORT');
  lines.push('================================================================================');
  lines.push(`Developer: ${analysis.username}`);
  lines.push(`Analysis Date: ${analysis.analysisDate.toISOString().split('T')[0]}`);
  lines.push(`Period: Last ${analysis.scope.days} days`);
  lines.push(`Processing Time: ${Math.round(analysis.processingTime / 1000)}s`);
  lines.push('');

  // Discovery Summary
  lines.push('📊 ACTIVITY DISCOVERY');
  lines.push('----------------------------------------');
  lines.push(`Repositories: ${analysis.discovery.totalRepositories}`);
  lines.push(`Commits: ${analysis.discovery.totalCommits}`);
  lines.push(`Issues: ${analysis.discovery.totalIssues}`);
  lines.push(`Pull Requests: ${analysis.discovery.totalPullRequests}`);
  lines.push(`Reviews: ${analysis.discovery.totalReviews}`);
  lines.push(`Comments: ${analysis.discovery.totalComments}`);
  lines.push(`Organizations: ${analysis.discovery.organizations.join(', ')}`);
  lines.push('');

  // Combined Score
  lines.push('🎯 OVERALL DEVELOPER SCORE');
  lines.push('----------------------------------------');
  lines.push(`Combined Score: ${analysis.combinedScore.combined.score}/10 (${(analysis.combinedScore.combined.confidence * 100).toFixed(0)}% confidence)`);
  lines.push(`Technical Weight: ${(analysis.combinedScore.combined.breakdown.technicalWeight * 100).toFixed(0)}%`);
  lines.push(`Social Weight: ${(analysis.combinedScore.combined.breakdown.socialWeight * 100).toFixed(0)}%`);
  lines.push('');

  // Technical Analysis
  if (analysis.technicalAnalysis) {
    lines.push('🔬 TECHNICAL ANALYSIS (Code Contributions)');
    lines.push('----------------------------------------');
    lines.push(`Code Complexity: ${analysis.combinedScore.technical.codeComplexity.toFixed(1)}/10`);
    lines.push(`Implementation Quality: ${analysis.combinedScore.technical.implementationQuality.toFixed(1)}/10`);
    lines.push(`Problem Solving: ${analysis.combinedScore.technical.problemSolving.toFixed(1)}/10`);
    lines.push(`Technical Score: ${analysis.combinedScore.technical.overall.toFixed(1)}/10`);
    
    if (analysis.technicalAnalysis.summary) {
      lines.push(`Repositories Analyzed: ${analysis.technicalAnalysis.summary.repositoriesAnalyzed}`);
      lines.push(`Total Contributions: ${analysis.technicalAnalysis.summary.totalContributions}`);
      lines.push(`Average Score: ${analysis.technicalAnalysis.summary.averageScore}`);
    }
    lines.push('');
  } else {
    lines.push('🔬 TECHNICAL ANALYSIS');
    lines.push('----------------------------------------');
    lines.push('No significant code contributions found in the analyzed period.');
    lines.push('');
  }

  // Social Analysis
  if (analysis.socialAnalysis && analysis.socialAnalysis.developerAnalyses.length > 0) {
    const social = analysis.socialAnalysis.developerAnalyses[0];
    lines.push('🤝 SOCIAL ANALYSIS (GitHub Interactions)');
    lines.push('----------------------------------------');
    lines.push(`Communication: ${social.communication}/10`);
    lines.push(`Collaboration: ${social.collaboration}/10`);
    lines.push(`Technical Quality: ${social.technicalQuality}/10`);
    lines.push(`Delivery: ${social.delivery}/10`);
    lines.push(`Social Score: ${social.overallScore}/10`);
    lines.push('');

    if (social.examples.length > 0) {
      lines.push('Examples:');
      social.examples.slice(0, 3).forEach((example: string) => {
        lines.push(`• ${example}`);
      });
      lines.push('');
    }

    if (social.suggestions.length > 0) {
      lines.push('Suggestions:');
      social.suggestions.slice(0, 3).forEach((suggestion: string) => {
        lines.push(`• ${suggestion}`);
      });
      lines.push('');
    }
  } else {
    lines.push('🤝 SOCIAL ANALYSIS');
    lines.push('----------------------------------------');
    lines.push('No significant social contributions found in the analyzed period.');
    lines.push('');
  }

  // Top Repositories
  if (analysis.discovery.repositories.length > 0) {
    lines.push('📈 TOP ACTIVE REPOSITORIES');
    lines.push('----------------------------------------');
    analysis.discovery.repositories.slice(0, 5).forEach((repo: any, index: number) => {
      const total = repo.commits + repo.issues + repo.pullRequests + repo.reviews + repo.comments;
      lines.push(`${index + 1}. ${repo.fullName} (${total} activities)`);
      lines.push(`   └─ Commits: ${repo.commits}, Issues: ${repo.issues}, PRs: ${repo.pullRequests}`);
    });
  }

  return lines.join('\n');
}

// ES modules don't have require.main, use import.meta instead
// Handle both direct execution and npm link (symlink) execution
import { fileURLToPath } from 'url';

const currentFile = fileURLToPath(import.meta.url);
const isMainModule =
  process.argv[1] === currentFile ||
  (fs.lstatSync(process.argv[1]).isSymbolicLink() && fs.realpathSync(process.argv[1]) === currentFile);

if (isMainModule) {
  main().catch(error => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

export { GitContributionScorer };
