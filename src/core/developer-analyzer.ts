import { logger } from '../utils/logger.js';
import { GitHubIssuesAnalyzer } from './github-issues-analyzer.js';
import { GitContributionScorer } from '../index.js';
import { GitHubDiscoveryService } from '../services/github-discovery.js';
import {
  DeveloperAnalysis,
  DeveloperScope,
  DeveloperScore,
  DeveloperDiscovery,
  DiscoveryFilters,
  ParallelOptions,
} from '../types/developer-types.js';
import { GitHubReport } from '../types/index.js';

export class DeveloperAnalyzer {
  private discoveryService: GitHubDiscoveryService;
  private githubAnalyzer: GitHubIssuesAnalyzer;
  private gitScorer: GitContributionScorer;

  constructor() {
    this.discoveryService = new GitHubDiscoveryService();
    this.githubAnalyzer = new GitHubIssuesAnalyzer();
    this.gitScorer = new GitContributionScorer();
  }

  async analyzeDeveloper(scope: DeveloperScope, filters?: DiscoveryFilters, parallelOptions?: ParallelOptions): Promise<DeveloperAnalysis> {
    const startTime = Date.now();
    
    logger.info(`🚀 Starting comprehensive analysis for developer: ${scope.username}`);

    // Phase 1: Discovery
    logger.info(`📊 Phase 1: Discovering ${scope.username}'s activity...`);
    const discovery = await this.discoveryService.discoverUserActivity(scope, filters);

    // Phase 2: Technical Analysis (Code Contributions)
    let technicalAnalysis: any = null;
    if (discovery.totalCommits > 0 && discovery.repositories.length > 0) {
      const mode = parallelOptions?.parallel ? `parallel (${parallelOptions.concurrency} concurrent)` : 'sequential';
      logger.info(`🔬 Phase 2: Analyzing technical contributions (${mode})...`);
      technicalAnalysis = await this.performTechnicalAnalysis(discovery, scope, parallelOptions);
    } else {
      logger.info('⏭️ Skipping technical analysis - no code contributions found');
    }

    // Phase 3: Social Analysis (GitHub Interactions)
    let socialAnalysis: GitHubReport | null = null;
    const socialActivityCount = discovery.totalIssues + discovery.totalPullRequests + 
                               discovery.totalReviews + discovery.totalComments;
    
    if (socialActivityCount > 0 && discovery.repositories.length > 0) {
      logger.info(`🤝 Phase 3: Analyzing social contributions...`);
      socialAnalysis = await this.performSocialAnalysis(discovery, scope);
    } else {
      logger.info('⏭️ Skipping social analysis - no social contributions found');
    }

    // Phase 4: Combine Results
    logger.info(`🎯 Phase 4: Generating combined developer score...`);
    const combinedScore = this.calculateCombinedScore(technicalAnalysis, socialAnalysis, discovery);

    const processingTime = Date.now() - startTime;

    const analysis: DeveloperAnalysis = {
      username: scope.username,
      scope,
      discovery,
      technicalAnalysis,
      socialAnalysis,
      combinedScore,
      analysisDate: new Date(),
      processingTime,
    };

    logger.info(`✅ Analysis complete for ${scope.username} in ${Math.round(processingTime / 1000)}s`);
    return analysis;
  }

  private async performTechnicalAnalysis(discovery: DeveloperDiscovery, scope: DeveloperScope, parallelOptions?: ParallelOptions): Promise<any> {
    // Find repositories with significant commit activity
    const codeRepos = discovery.repositories.filter(repo => repo.commits >= 1);
    
    if (codeRepos.length === 0) {
      logger.info('No repositories with significant commit activity found');
      return null;
    }

    logger.info(`Analyzing code contributions in ${codeRepos.length} repositories`);

    // For now, we'll analyze the top repositories by commit count
    // In the future, we could analyze all repositories or use a different strategy
    const topRepos = codeRepos
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 3); // Limit to top 3 repos to keep analysis reasonable

    const results = [];

    if (parallelOptions?.parallel && (parallelOptions.concurrency || 5) > 1) {
      // Parallel repository analysis
      logger.info(`🚀 Running parallel analysis with ${parallelOptions.concurrency || 5} concurrent operations`);
      
      const analyzeRepo = async (repo: any) => {
        try {
          logger.info(`🔍 Starting parallel analysis of ${repo.fullName}...`);
          
          const repoUrl = `https://github.com/${repo.fullName}`;
          const report = await this.gitScorer.analyzeContributions(repoUrl, scope.days, 20, parallelOptions);
          
          logger.info(`✅ Completed technical analysis for ${repo.fullName}`);
          return {
            repository: repo.fullName,
            report,
            commits: repo.commits,
          };
        } catch (error) {
          logger.warn(`❌ Failed to analyze ${repo.fullName}: ${error}`);
          return null;
        }
      };

      // Process repositories in parallel batches
      const concurrency = Math.min(parallelOptions.concurrency || 5, topRepos.length);
      const analysisPromises = topRepos.map(repo => analyzeRepo(repo));
      
      const parallelResults = await Promise.allSettled(analysisPromises);
      
      for (const result of parallelResults) {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      }
    } else {
      // Sequential repository analysis (default)
      for (const repo of topRepos) {
        try {
          logger.info(`Analyzing code contributions in ${repo.fullName}...`);
          
          // Use the existing git analyzer for this repository
          const repoUrl = `https://github.com/${repo.fullName}`;
          const report = await this.gitScorer.analyzeContributions(repoUrl, scope.days, 20, parallelOptions);
          
          results.push({
            repository: repo.fullName,
            report,
            commits: repo.commits,
          });
          
          logger.info(`✅ Completed technical analysis for ${repo.fullName}`);
        } catch (error) {
          logger.warn(`Failed to analyze ${repo.fullName}: ${error}`);
        }
      }
    }

    return {
      repositoriesAnalyzed: results.length,
      results,
      summary: this.summarizeTechnicalResults(results),
    };
  }

  private async performSocialAnalysis(discovery: DeveloperDiscovery, scope: DeveloperScope): Promise<GitHubReport | null> {
    // Find repositories with significant social activity
    const socialRepos = discovery.repositories.filter(repo => 
      (repo.issues + repo.pullRequests + repo.reviews + repo.comments) >= 2
    );

    if (socialRepos.length === 0) {
      logger.info('No repositories with significant social activity found');
      return null;
    }

    logger.info(`Analyzing social contributions in ${socialRepos.length} repositories`);

    // For social analysis, we'll focus on the most active repository
    // or combine data from multiple repositories
    const topSocialRepo = socialRepos
      .sort((a, b) => 
        (b.issues + b.pullRequests + b.reviews + b.comments) - 
        (a.issues + a.pullRequests + a.reviews + a.comments)
      )[0];

    try {
      const repoUrl = `https://github.com/${topSocialRepo.fullName}`;
      logger.info(`Analyzing social contributions in ${topSocialRepo.fullName}...`);
      
      const report = await this.githubAnalyzer.analyzeRepository(repoUrl, scope.days);
      
      // Filter the report to only include our target developer
      const filteredReport = this.filterSocialAnalysisForDeveloper(report, scope.username);
      
      logger.info(`✅ Completed social analysis for ${topSocialRepo.fullName}`);
      return filteredReport;
    } catch (error) {
      logger.warn(`Failed to perform social analysis: ${error}`);
      return null;
    }
  }

  private filterSocialAnalysisForDeveloper(report: GitHubReport, username: string): GitHubReport {
    // Filter the GitHub report to only include analysis for our target developer
    const developerAnalysis = report.developerAnalyses.filter(
      analysis => analysis.developer === username
    );

    return {
      ...report,
      developerAnalyses: developerAnalysis,
      summary: {
        ...report.summary,
        topPerformers: developerAnalysis.length > 0 ? [username] : [],
        averageScore: developerAnalysis.length > 0 ? developerAnalysis[0].overallScore : 0,
      },
    };
  }

  private summarizeTechnicalResults(results: any[]): any {
    if (results.length === 0) {
      return null;
    }

    // Extract all contribution scores from all repositories
    const allScores = results.flatMap(result => result.report.developerScores || []);
    
    if (allScores.length === 0) {
      return { averageScore: 0, totalContributions: 0 };
    }

    const averageScore = allScores.reduce((sum, score) => sum + score.score, 0) / allScores.length;
    const totalContributions = allScores.length;

    return {
      averageScore: Math.round(averageScore * 10) / 10,
      totalContributions,
      repositoriesAnalyzed: results.length,
      topScore: Math.max(...allScores.map(s => s.score)),
      scoreDistribution: this.calculateScoreDistribution(allScores),
    };
  }

  private calculateScoreDistribution(scores: any[]): { [key: string]: number } {
    const distribution: { [key: string]: number } = {};
    
    for (const score of scores) {
      const bucket = Math.floor(score.score / 10) * 10;
      const bucketKey = `${bucket}-${bucket + 9}`;
      distribution[bucketKey] = (distribution[bucketKey] || 0) + 1;
    }

    return distribution;
  }

  private calculateCombinedScore(
    technicalAnalysis: any,
    socialAnalysis: GitHubReport | null,
    discovery: DeveloperDiscovery
  ): DeveloperScore {
    // Initialize default scores
    let technicalScore = { codeComplexity: 0, implementationQuality: 0, problemSolving: 0, overall: 0 };
    let socialScore = { communication: 0, collaboration: 0, leadership: 0, delivery: 0, overall: 0 };

    // Extract technical scores
    if (technicalAnalysis?.summary) {
      const avgScore = technicalAnalysis.summary.averageScore || 0;
      // Convert git analysis score (0-100+) to 0-10 scale
      const normalizedScore = Math.min(avgScore / 10, 10);
      
      technicalScore = {
        codeComplexity: normalizedScore,
        implementationQuality: normalizedScore,
        problemSolving: normalizedScore,
        overall: normalizedScore,
      };
    }

    // Extract social scores
    if (socialAnalysis?.developerAnalyses && socialAnalysis.developerAnalyses.length > 0) {
      const analysis = socialAnalysis.developerAnalyses[0];
      socialScore = {
        communication: analysis.communication,
        collaboration: analysis.collaboration,
        leadership: (analysis.technicalQuality + analysis.delivery) / 2, // Approximate leadership
        delivery: analysis.delivery,
        overall: analysis.overallScore,
      };
    }

    // Calculate confidence based on available data
    const hasCodeData = technicalAnalysis && discovery.totalCommits > 0;
    const hasSocialData = socialAnalysis && 
      (discovery.totalIssues + discovery.totalPullRequests + discovery.totalReviews + discovery.totalComments) > 0;

    let confidence = 0;
    if (hasCodeData && hasSocialData) confidence = 0.9;
    else if (hasCodeData || hasSocialData) confidence = 0.6;
    else confidence = 0.1;

    // Calculate weights based on available data and activity levels
    let technicalWeight = 0.5;
    let socialWeight = 0.5;

    if (hasCodeData && !hasSocialData) {
      technicalWeight = 1.0;
      socialWeight = 0.0;
    } else if (!hasCodeData && hasSocialData) {
      technicalWeight = 0.0;
      socialWeight = 1.0;
    } else if (hasCodeData && hasSocialData) {
      // Adjust weights based on activity levels
      const codeActivity = discovery.totalCommits;
      const socialActivity = discovery.totalIssues + discovery.totalPullRequests + 
                           discovery.totalReviews + discovery.totalComments;
      
      const total = codeActivity + socialActivity;
      if (total > 0) {
        technicalWeight = codeActivity / total;
        socialWeight = socialActivity / total;
        
        // Ensure weights are reasonable (between 0.2 and 0.8)
        technicalWeight = Math.max(0.2, Math.min(0.8, technicalWeight));
        socialWeight = 1 - technicalWeight;
      }
    }

    // Calculate combined score
    const combinedScoreValue = (technicalScore.overall * technicalWeight) + 
                              (socialScore.overall * socialWeight);

    return {
      technical: technicalScore,
      social: socialScore,
      combined: {
        score: Math.round(combinedScoreValue * 10) / 10,
        confidence,
        breakdown: {
          technicalWeight: Math.round(technicalWeight * 100) / 100,
          socialWeight: Math.round(socialWeight * 100) / 100,
        },
      },
    };
  }
}