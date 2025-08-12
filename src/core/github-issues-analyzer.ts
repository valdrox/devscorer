import { Octokit } from 'octokit';
import { 
  DeveloperActivity, 
  GitHubAnalysis, 
  GitHubReport, 
  GitHubIssue, 
  GitHubPullRequest, 
  GitHubReview, 
  GitHubComment 
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { ClaudeRunner } from './claude-runner.js';
import { authManager } from '../auth/auth-manager.js';

export class GitHubIssuesAnalyzer {
  private octokit: Octokit | null = null;
  private claudeRunner: ClaudeRunner;

  constructor() {
    this.claudeRunner = new ClaudeRunner();
  }

  private async initializeOctokit(): Promise<void> {
    if (!this.octokit) {
      const githubToken = await this.getGitHubToken();
      this.octokit = new Octokit({ auth: githubToken });
    }
  }

  private async getGitHubToken(): Promise<string> {
    return await authManager.getGitHubToken();
  }

  private async getDefaultBranch(owner: string, repo: string): Promise<string> {
    if (!this.octokit) throw new Error('Octokit not initialized');

    try {
      const response = await this.octokit.rest.repos.get({
        owner,
        repo,
      });
      return response.data.default_branch;
    } catch (error) {
      logger.debug(`Failed to get default branch, falling back to 'main': ${error}`);
      return 'main'; // Fallback to 'main' if we can't determine the default branch
    }
  }

  private parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      throw new Error('Invalid GitHub repository URL. Expected format: https://github.com/owner/repo');
    }
    return {
      owner: match[1],
      repo: match[2].replace('.git', ''),
    };
  }

  async analyzeRepository(repoUrl: string, days: number): Promise<GitHubReport> {
    logger.info(`Starting GitHub analysis of ${repoUrl} for the last ${days} days`);
    
    try {
      await this.initializeOctokit();
      logger.debug(`Octokit initialized successfully`);
    } catch (error) {
      logger.error(`Failed to initialize Octokit: ${error}`);
      throw error;
    }
    
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    logger.debug(`Parsed repo URL: owner=${owner}, repo=${repo}`);

    // Get all contributors in the time period
    const contributors = await this.getContributors(owner, repo, days);
    logger.info(`Found ${contributors.length} contributors to analyze`);

    // Fetch activity for each developer
    const activities: DeveloperActivity[] = [];
    let processedCount = 0;
    for (const contributor of contributors) {
      processedCount++;
      logger.debug(`Processing contributor ${processedCount}/${contributors.length}: ${contributor}`);
      
      try {
        logger.debug(`Fetching activity for ${contributor}...`);
        const activity = await this.fetchDeveloperActivity(owner, repo, contributor, days);
        logger.debug(`Activity fetched for ${contributor}: ${activity.issues.length} issues, ${activity.pullRequests.length} PRs, ${activity.reviews.length} reviews, ${activity.comments.length} comments`);
        
        if (this.hasSignificantActivity(activity)) {
          logger.debug(`${contributor} has significant activity, adding to analysis list`);
          activities.push(activity);
        } else {
          logger.debug(`${contributor} has insufficient activity (threshold: 2), skipping`);
        }
      } catch (error) {
        logger.error(`Failed to fetch activity for ${contributor}: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error) {
          logger.error(`Error details: ${error.message}`, error);
        } else {
          logger.error(`Error details: ${String(error)}`);
        }
      }
    }

    logger.info(`Analyzing ${activities.length} developers with significant activity`);

    // Evaluate each developer with LLM
    const evaluations: GitHubAnalysis[] = [];
    let evaluationCount = 0;
    for (const activity of activities) {
      evaluationCount++;
      logger.info(`Evaluating developer ${evaluationCount}/${activities.length}: ${activity.developer}`);
      
      try {
        logger.debug(`Starting LLM evaluation for ${activity.developer}...`);
        const evaluation = await this.evaluateDeveloper(activity);
        logger.debug(`Successfully evaluated ${activity.developer}, score: ${evaluation.overallScore}`);
        evaluations.push(evaluation);
      } catch (error) {
        logger.error(`Failed to evaluate developer ${activity.developer}: ${error instanceof Error ? error.message : String(error)}`);
        logger.error(`Error type: ${error?.constructor?.name}`);
        if (error instanceof Error && error.stack) {
          logger.error(`Error stack: ${error.stack}`);
        }
        
        // Add a fallback evaluation so analysis can continue
        const fallbackEvaluation = {
          developer: activity.developer,
          technicalQuality: 5,
          communication: 5,
          collaboration: 5,
          delivery: 5,
          overallScore: 5.0,
          examples: [`Error during evaluation: ${error instanceof Error ? error.message : 'Unknown error'}`],
          suggestions: ['Analysis failed - please try again'],
        };
        evaluations.push(fallbackEvaluation);
      }
    }

    return this.generateReport(repoUrl, days, evaluations);
  }

  private async getContributors(owner: string, repo: string, days: number): Promise<string[]> {
    if (!this.octokit) throw new Error('Octokit not initialized');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const contributors = new Set<string>();

    try {
      // Get contributors from recent commits on main/master branch only
      const commits = await this.octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: await this.getDefaultBranch(owner, repo),
        since: since.toISOString(),
        per_page: 100,
      });

      for (const commit of commits.data) {
        if (commit.author?.login) {
          contributors.add(commit.author.login);
        }
      }

      const commitContributors = new Set(contributors);
      logger.info(`Found ${commitContributors.size} contributors from commits on ${await this.getDefaultBranch(owner, repo)} branch`);

      // Get contributors from recent issues
      const issues = await this.octokit.rest.issues.listForRepo({
        owner,
        repo,
        since: since.toISOString(),
        per_page: 100,
        state: 'all',
      });

      for (const issue of issues.data) {
        if (issue.user?.login) {
          contributors.add(issue.user.login);
        }
      }

      const issueContributors = contributors.size - commitContributors.size;
      logger.info(`Found ${issueContributors} additional contributors from issues`);
      logger.info(`Total unique contributors: ${contributors.size}`);

      return Array.from(contributors);
    } catch (error) {
      logger.error(`Failed to get contributors: ${error}`);
      return [];
    }
  }

  async fetchDeveloperActivity(
    owner: string,
    repo: string,
    developer: string,
    days: number
  ): Promise<DeveloperActivity> {
    if (!this.octokit) throw new Error('Octokit not initialized');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    logger.debug(`Fetching activity for ${developer} in ${owner}/${repo}`);

    const [issues, prs, reviews, comments] = await Promise.all([
      this.fetchIssues(owner, repo, developer, since),
      this.fetchPullRequests(owner, repo, developer, since),
      this.fetchReviews(owner, repo, developer, since),
      this.fetchComments(owner, repo, developer, since),
    ]);

    return {
      developer,
      issues,
      pullRequests: prs,
      reviews,
      comments,
    };
  }

  private async fetchIssues(
    owner: string,
    repo: string,
    developer: string,
    since: Date
  ): Promise<GitHubIssue[]> {
    if (!this.octokit) return [];

    try {
      logger.debug(`Fetching issues for ${developer} since ${since.toISOString()}...`);
      const response = await this.octokit.rest.issues.listForRepo({
        owner,
        repo,
        creator: developer,
        since: since.toISOString(),
        state: 'all',
        per_page: 100,
      });

      const issues = response.data.filter((issue: any) => !issue.pull_request) as GitHubIssue[];
      logger.debug(`Found ${issues.length} issues for ${developer}`);
      return issues;
    } catch (error: any) {
      logger.error(`Failed to fetch issues for ${developer}: ${error?.message || error}`);
      logger.error(`Error status: ${error?.status}, Error response: ${JSON.stringify(error?.response?.data)}`);
      return [];
    }
  }

  private async fetchPullRequests(
    owner: string,
    repo: string,
    developer: string,
    since: Date
  ): Promise<GitHubPullRequest[]> {
    if (!this.octokit) return [];

    try {
      logger.debug(`Fetching PRs for ${developer} since ${since.toISOString()}...`);
      const response = await this.octokit.rest.pulls.list({
        owner,
        repo,
        state: 'all',
        per_page: 100,
      });

      const prs = response.data.filter(
        (pr: any) => pr.user?.login === developer && new Date(pr.created_at) >= since
      ) as GitHubPullRequest[];
      logger.debug(`Found ${prs.length} PRs for ${developer}`);
      return prs;
    } catch (error: any) {
      logger.error(`Failed to fetch PRs for ${developer}: ${error?.message || error}`);
      logger.error(`Error status: ${error?.status}, Error response: ${JSON.stringify(error?.response?.data)}`);
      return [];
    }
  }

  private async fetchReviews(
    owner: string,
    repo: string,
    developer: string,
    since: Date
  ): Promise<GitHubReview[]> {
    if (!this.octokit) return [];

    const reviews: GitHubReview[] = [];

    try {
      // Get recent PRs to check for reviews
      const prs = await this.octokit.rest.pulls.list({
        owner,
        repo,
        state: 'all',
        per_page: 50,
      });

      for (const pr of prs.data) {
        if (new Date(pr.created_at) < since) continue;

        try {
          const prReviews = await this.octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
          });

          const developerReviews = prReviews.data.filter(
            (review: any) => review.user?.login === developer && new Date(review.submitted_at || 0) >= since
          );

          for (const review of developerReviews) {
            reviews.push({
              id: review.id,
              body: review.body || '',
              state: review.state as 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED',
              submitted_at: review.submitted_at || '',
              user: { login: developer },
              pull_request: {
                title: pr.title,
                number: pr.number,
              },
            });
          }
        } catch (error) {
          logger.debug(`Failed to fetch reviews for PR #${pr.number}: ${error}`);
        }
      }

      return reviews;
    } catch (error) {
      logger.debug(`Failed to fetch reviews for ${developer}: ${error}`);
      return [];
    }
  }

  private async fetchComments(
    owner: string,
    repo: string,
    developer: string,
    since: Date
  ): Promise<GitHubComment[]> {
    if (!this.octokit) return [];

    const comments: GitHubComment[] = [];

    try {
      // Get issue comments
      const issueComments = await this.octokit.rest.issues.listCommentsForRepo({
        owner,
        repo,
        since: since.toISOString(),
        per_page: 100,
      });

      const developerIssueComments = issueComments.data.filter(
        (comment: any) => comment.user?.login === developer
      );

      for (const comment of developerIssueComments) {
        comments.push({
          id: comment.id,
          body: comment.body || '',
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          user: { login: developer },
          issue_url: comment.issue_url,
        });
      }

      return comments;
    } catch (error) {
      logger.debug(`Failed to fetch comments for ${developer}: ${error}`);
      return [];
    }
  }

  private hasSignificantActivity(activity: DeveloperActivity): boolean {
    const totalActivity = 
      activity.issues.length + 
      activity.pullRequests.length + 
      activity.reviews.length + 
      activity.comments.length;
    
    return totalActivity >= 2; // Minimum threshold for analysis
  }

  private async evaluateDeveloper(activity: DeveloperActivity): Promise<GitHubAnalysis> {
    logger.debug(`Evaluating developer: ${activity.developer}`);

    const prompt = this.buildEvaluationPrompt(activity);
    logger.debug(`Evaluation prompt for ${activity.developer}: ${prompt.substring(0, 200)}...`);
    
    // Use existing Claude runner
    const response = await this.claudeRunner.runAnalysis(prompt);
    logger.debug(`Raw LLM response for ${activity.developer} (${response.length} chars): ${response.substring(0, 300)}...`);
    
    try {
      // Try to extract JSON from markdown code blocks if present
      let jsonResponse = response.trim();
      
      // Check if response is wrapped in markdown code blocks
      if (jsonResponse.startsWith('```json') || jsonResponse.startsWith('```')) {
        logger.debug(`Detected markdown code block for ${activity.developer}, extracting JSON...`);
        // Remove markdown code block markers
        jsonResponse = jsonResponse.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim();
        logger.debug(`Extracted JSON for ${activity.developer}: ${jsonResponse.substring(0, 200)}...`);
      }
      
      const analysis = JSON.parse(jsonResponse);
      logger.debug(`Successfully parsed JSON for ${activity.developer}:`, analysis);
      
      const overallScore = (
        analysis.technicalQuality + 
        analysis.communication + 
        analysis.collaboration + 
        analysis.delivery
      ) / 4;

      return {
        developer: activity.developer,
        technicalQuality: analysis.technicalQuality || 0,
        communication: analysis.communication || 0,
        collaboration: analysis.collaboration || 0,
        delivery: analysis.delivery || 0,
        overallScore: Math.round(overallScore * 10) / 10,
        examples: analysis.examples || [],
        suggestions: analysis.suggestions || [],
      };
    } catch (error) {
      logger.error(`Failed to parse LLM response for ${activity.developer}: ${error}`);
      logger.error(`Problematic response: ${response}`);
      return {
        developer: activity.developer,
        technicalQuality: 5,
        communication: 5,
        collaboration: 5,
        delivery: 5,
        overallScore: 5.0,
        examples: [],
        suggestions: ['Unable to analyze - please try again'],
      };
    }
  }

  private buildEvaluationPrompt(activity: DeveloperActivity): string {
    const issuesSummary = activity.issues
      .slice(0, 5)
      .map(i => `- "${i.title}": ${(i.body || '').slice(0, 150)}...`)
      .join('\n');

    const prsSummary = activity.pullRequests
      .slice(0, 5)
      .map(pr => `- "${pr.title}": ${(pr.body || '').slice(0, 150)}...`)
      .join('\n');

    const reviewsSummary = activity.reviews
      .slice(0, 5)
      .map(r => `- On "${r.pull_request.title}": ${r.body.slice(0, 150)}...`)
      .join('\n');

    const commentsSummary = activity.comments
      .slice(0, 10)
      .map(c => `- ${c.body.slice(0, 100)}...`)
      .join('\n');

    return `You are a patient Senior Staff Engineer evaluating a developer's GitHub activity over the past few months.

DEVELOPER: ${activity.developer}

ISSUES CREATED (${activity.issues.length}):
${issuesSummary || 'None'}

PULL REQUESTS (${activity.pullRequests.length}):
${prsSummary || 'None'}

REVIEWS GIVEN (${activity.reviews.length}):
${reviewsSummary || 'None'}

COMMENTS (${activity.comments.length}):
${commentsSummary || 'None'}

Rate this developer 0-10 on:
1. Technical Quality (issue clarity, PR descriptions, review depth, problem-solving approach)
2. Communication (helpfulness, clarity, politeness, constructiveness)  
3. Collaboration (cross-team mentions, consensus building, knowledge sharing)
4. Delivery (follow-through, consistency, business awareness)

Provide specific examples from their activity and actionable suggestions for improvement.

CRITICAL: Respond with ONLY raw JSON, no markdown code blocks, no explanations, no additional text.

Expected format:
{
  "technicalQuality": 7,
  "communication": 8, 
  "collaboration": 6,
  "delivery": 9,
  "examples": ["Specific example with reference to their activity"],
  "suggestions": ["Specific actionable suggestion for improvement"]
}`;
  }

  private generateReport(repoUrl: string, days: number, evaluations: GitHubAnalysis[]): GitHubReport {
    const topPerformers = evaluations
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 3)
      .map(e => e.developer);

    const averageScore = evaluations.reduce((sum, e) => sum + e.overallScore, 0) / evaluations.length;

    const teamInsights = [
      `Analyzed ${evaluations.length} developers with significant GitHub activity`,
      `Average collaboration score: ${(evaluations.reduce((sum, e) => sum + e.collaboration, 0) / evaluations.length).toFixed(1)}/10`,
      `Average communication score: ${(evaluations.reduce((sum, e) => sum + e.communication, 0) / evaluations.length).toFixed(1)}/10`,
    ];

    return {
      repositoryUrl: repoUrl,
      analysisDate: new Date(),
      daysCovered: days,
      developerAnalyses: evaluations,
      summary: {
        topPerformers,
        averageScore: Math.round(averageScore * 10) / 10,
        teamInsights,
      },
    };
  }
}