import { GitAnalyzer } from './git-analyzer.js';
import { BusinessExtractor } from './business-extractor.js';
import { ClaudeRunner } from './claude-runner.js';
import { CodeComparator } from './code-comparator.js';
import { ScoringEngine } from './scoring-engine.js';
import { ContributionScore, AnalysisReport, GitContribution, Hint, TechnicalComparison } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export class GitContributionScorer {
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

  async analyzeContributions(repoUrl: string, days: number = 7, limit?: number, parallelOptions?: any): Promise<AnalysisReport> {
    const limitText = limit ? ` (max ${limit} commits)` : '';
    logger.info(`Starting analysis of ${repoUrl} for the last ${days} days${limitText}`);

    try {
      const repoPath = await this.gitAnalyzer.cloneRepository(repoUrl);
      logger.info(`Repository cloned successfully`);

      const allRecentContributions = await this.gitAnalyzer.getRecentContributions(days);

      // Apply limit if specified
      const contributionsToAnalyze = limit ? allRecentContributions.slice(0, limit) : allRecentContributions;

      if (contributionsToAnalyze.length === 0) {
        logger.info('No significant contributions found in the specified period');
        return this.scoringEngine.generateDetailedReport(repoUrl, days, []);
      }

      logger.info(`Found ${contributionsToAnalyze.length} contributions to analyze`);

      // Analyze contributions in parallel or sequentially based on options
      const developerScores: ContributionScore[] = [];
      
      if (parallelOptions?.parallel && parallelOptions.concurrency > 1) {
        logger.info(`🚀 Running parallel analysis with ${parallelOptions.concurrency} concurrent operations`);
        
        const analyzeContribution = async (contribution: GitContribution) => {
          try {
            logger.info(`🔍 Starting parallel analysis of ${contribution.branch}...`);
            const score = await this.analyzeContribution(contribution, { useHints: true, maxHints: config.maxHintsPerAnalysis });
            logger.info(`✅ Completed analysis for ${contribution.branch}`);
            return score;
          } catch (error) {
            logger.error(`❌ Failed to analyze contribution ${contribution.branch}: ${error}`);
            return null;
          }
        };

        // Process contributions in parallel batches
        const batchSize = Math.min(parallelOptions.concurrency, contributionsToAnalyze.length);
        const analysisPromises = contributionsToAnalyze.map(contribution => analyzeContribution(contribution));
        
        const results = await Promise.allSettled(analysisPromises);
        
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            developerScores.push(result.value);
          }
        }
      } else {
        // Sequential analysis (default)
        for (const contribution of contributionsToAnalyze) {
          try {
            logger.info(`Analyzing contribution ${developerScores.length + 1}/${contributionsToAnalyze.length}: ${contribution.branch}`);
            
            const score = await this.analyzeContribution(contribution, { useHints: true, maxHints: config.maxHintsPerAnalysis });
            if (score) {
              developerScores.push(score);
            }
          } catch (error) {
            logger.error(`Failed to analyze contribution ${contribution.branch}: ${error}`);
          }
        }
      }

      await this.gitAnalyzer.cleanup();

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

      const contribution = await this.gitAnalyzer.getCommitContribution(commitHash);

      if (!contribution) {
        logger.warn(`No contribution data found for commit ${commitHash}`);
        return null;
      }

      const score = await this.analyzeContribution(contribution, { useHints: true, maxHints: config.maxHintsPerAnalysis });

      await this.gitAnalyzer.cleanup();

      return score;
    } catch (error) {
      await this.gitAnalyzer.cleanup();
      throw error;
    }
  }

  private async analyzeContribution(contribution: GitContribution, options: { useHints: boolean; maxHints: number } = { useHints: true, maxHints: 3 }): Promise<ContributionScore | null> {
    logger.info(`🔍 Exploring ${contribution.branch} by ${contribution.author}`);

    let preCommitRepoPath: string = '';

    try {
      // Step 1: Extract business purpose
      const businessPurpose = await this.businessExtractor.extractBusinessPurpose(contribution);
      logger.debug(`🎯 Extracted business purpose: ${businessPurpose.summary}`);
      logger.debug(`📋 Requirements (${businessPurpose.requirements.length}): ${businessPurpose.requirements.join('; ')}`);

      // Step 2: Categorize contribution
      const category = this.categorizeContribution(contribution);
      logger.debug(`Contribution categorized as: ${category.type} `);

      if (category.type === 'documentation-only') {
        logger.info(`Skipping analysis for documentation-only contribution: ${contribution.branch}`);
        return null;
      }

      // Step 3: Attempt to reproduce with Claude Code (using existing repo)
      const hints: Hint[] = [];
      let attempts = 0;
      const maxAttempts = options.useHints ? options.maxHints + 1 : 1;

      logger.info(`Starting Claude Code analysis for ${contribution.branch} (max ${maxAttempts} attempts)`);

      while (attempts < maxAttempts) {
        attempts++;
        logger.info(`Attempt ${attempts}/${maxAttempts} for ${contribution.branch}`);

        try {
          const claudeResult = await this.claudeRunner.runClaudeCode(
            businessPurpose,
            contribution.projectContext,
            contribution.commitHash,
            contribution.diff,
            hints,
            this.gitAnalyzer
          );

          if (claudeResult.success && claudeResult.code) {
            logger.info(`✅ Claude Code succeeded on attempt ${attempts} for ${contribution.branch}`);

            // Compare the results
            const comparison: TechnicalComparison = await this.codeComparator.compareTechnicalContributions(contribution.diff, claudeResult.code, businessPurpose.requirements);

            // Calculate final score based on original implementation
            const complexityScore = this.scoringEngine.calculateComplexityScore(
              contribution,
              hints.length,
              hints,
              attempts,
              comparison.isEquivalent
            );

            const contributionScore = this.scoringEngine.createContributionScore(
              contribution,
              businessPurpose,
              complexityScore,
              hints.length,
              hints,
              attempts
            );

            logger.info(`📊 Final score for ${contribution.branch}: ${complexityScore}`);

            return contributionScore;
          } else {
            logger.warn(`❌ Claude Code attempt ${attempts} failed for ${contribution.branch}: ${claudeResult.errors?.join(', ') || 'Unknown error'}`);

            if (attempts < maxAttempts && options.useHints) {
              // Generate a hint for the next attempt
              logger.info(`Generating hint ${hints.length + 1} for ${contribution.branch}`);
              const hint = await this.generateHint(contribution, claudeResult, hints.length + 1);
              hints.push(hint);
              logger.debug(`Generated hint: ${hint.content}`);
            }
          }
        } catch (error) {
          logger.error(`Error during attempt ${attempts} for ${contribution.branch}: ${error}`);
          if (attempts >= maxAttempts) {
            throw error;
          }
        }
      }

      // If we get here, all attempts failed
      logger.warn(`All ${maxAttempts} attempts failed for ${contribution.branch}`);
      return null;

    } finally {
      // Cleanup is handled by gitAnalyzer.cleanup() in the main flow
    }
  }

  private categorizeContribution(contribution: GitContribution): { type: string; hasDocumentationChanges: boolean } {
    try {
      const diff = contribution.diff.toLowerCase();
      
      // Check for documentation changes
      const hasDocumentationChanges = /\.(md|txt|rst|adoc)[\s\S]*?[-+]/.test(diff) ||
                                     /readme|changelog|contributing|license|docs\//.test(diff);

      // Check for logic changes
      const hasLogicChanges = /\.(js|ts|py|java|cpp|c|go|rs|php|rb|cs)[\s\S]*?[-+]/.test(diff);

      // Check for configuration changes
      const hasConfigChanges = /\.(json|yaml|yml|toml|xml|env|config)[\s\S]*?[-+]/.test(diff) ||
                              /package\.json|tsconfig|\.env|docker|makefile/i.test(diff);


      if (hasDocumentationChanges && !hasLogicChanges && !hasConfigChanges) {
        return { type: 'documentation-only', hasDocumentationChanges: true };
      } else if (hasLogicChanges) {
        return { type: 'logic', hasDocumentationChanges };
      } else if (hasConfigChanges) {
        return { type: 'configuration', hasDocumentationChanges };
      } else {
        return { type: 'other', hasDocumentationChanges };
      }
    } catch (error) {
      logger.warn(`Failed to categorize contribution ${contribution.branch}: ${error}`);
      return { type: 'unknown', hasDocumentationChanges: false };
    }
  }


  private async generateHint(contribution: GitContribution, claudeResult: any, hintLevel: number): Promise<Hint> {
    // Create gaps and differences from the Claude result
    const gaps = claudeResult.errors || ['Implementation failed'];
    const differences = claudeResult.issues || [];
    
    const hint = await this.codeComparator.generateProgressiveHint(gaps, differences, hintLevel, []);
    
    return hint;
  }
}