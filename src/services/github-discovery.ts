import { Octokit } from 'octokit';
import { logger } from '../utils/logger.js';
import { authManager } from '../auth/auth-manager.js';
import {
  DeveloperDiscovery,
  DeveloperScope,
  RepositoryActivity,
  DiscoveryFilters,
} from '../types/developer-types.js';

export class GitHubDiscoveryService {
  private octokit: Octokit | null = null;

  private async initializeOctokit(): Promise<void> {
    if (!this.octokit) {
      const githubToken = await authManager.getGitHubToken();
      this.octokit = new Octokit({ auth: githubToken });
    }
  }

  private isSignificantCommit(message: string): boolean {
    // Skip very small or automated commits (same logic as GitAnalyzer)
    const skipPatterns = [
      /^version bump/i,
      /^bump version/i,
      /^release/i,
      /^\d+\.\d+\.\d+$/,
      /^update package\.json/i,
      /^update changelog/i,
      /^update readme/i,
      /^fix typo/i,
      /^formatting/i,
      /^lint/i,
      /^chore:/i,
    ];

    if (skipPatterns.some(pattern => pattern.test(message))) {
      return false;
    }

    // Must have reasonable length
    return message.length > 10;
  }

  async discoverUserActivity(scope: DeveloperScope, filters?: DiscoveryFilters): Promise<DeveloperDiscovery> {
    await this.initializeOctokit();
    if (!this.octokit) throw new Error('GitHub API not initialized');

    logger.info(`🔍 Discovering activity for user '${scope.username}' over last ${scope.days} days`);

    const since = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);
    const repositories: RepositoryActivity[] = [];
    const organizations = new Set<string>();

    let totalCommits = 0;
    let totalIssues = 0;
    let totalPullRequests = 0;
    let totalReviews = 0;
    let totalComments = 0;

    try {
      // Get user's recent events to find active repositories
      logger.debug(`🔍 GitHub Discovery: Starting event discovery for user "${scope.username}"`);
      const events = await this.getUserEvents(scope.username, scope.days);
      logger.info(`📊 GitHub Discovery: Found ${events.length} recent events for ${scope.username}`);

      // Extract unique repositories from events
      const repoSet = new Set<string>();
      const eventTypeCount: { [key: string]: number } = {};
      
      for (const event of events) {
        if (event.repo?.name) {
          repoSet.add(event.repo.name);
        }
        
        // Count event types for debugging
        eventTypeCount[event.type] = (eventTypeCount[event.type] || 0) + 1;
      }

      logger.info(`📈 GitHub Discovery: Found activity in ${repoSet.size} repositories`);
      logger.debug(`📝 Event types found: ${JSON.stringify(eventTypeCount)}`);
      logger.debug(`📝 Repositories discovered from events: ${Array.from(repoSet).join(', ')}`);

      // For each repository, get detailed activity
      let processedRepos = 0;
      let filteredOutRepos = 0;
      
      // Process repositories in parallel for faster discovery
      const getRepoActivity = async (repoFullName: string) => {
        try {
          const [owner, name] = repoFullName.split('/');
          if (!owner || !name) return null;

          logger.debug(`\n🔍 Analyzing repository: ${repoFullName}`);
          
          // Apply filters
          if (filters?.organizations?.length && !filters.organizations.includes(owner)) {
            logger.debug(`❌ Filtered out ${repoFullName}: organization "${owner}" not in allowed list`);
            return { filtered: true, reason: 'organization' };
          }

          if (filters?.repositories?.length && !filters.repositories.includes(repoFullName)) {
            logger.debug(`❌ Filtered out ${repoFullName}: repository not in allowed list`);
            return { filtered: true, reason: 'repository' };
          }

          if (filters?.orgRepositories && owner !== filters.orgRepositories) {
            logger.debug(`❌ Filtered out ${repoFullName}: owner "${owner}" doesn't match required org "${filters.orgRepositories}"`);
            return { filtered: true, reason: 'orgRepositories' };
          }

          const repoActivity = await this.getRepositoryActivity(owner, name, scope.username, since);
          
          // Apply minimum activity filter
          const totalActivity = repoActivity.commits + repoActivity.issues + 
                               repoActivity.pullRequests + repoActivity.reviews + 
                               repoActivity.comments;
          
          logger.debug(`📊 Repository activity for ${repoFullName}:`);
          logger.debug(`   - Commits: ${repoActivity.commits}`);
          logger.debug(`   - Issues: ${repoActivity.issues}`);
          logger.debug(`   - Pull Requests: ${repoActivity.pullRequests}`);
          logger.debug(`   - Reviews: ${repoActivity.reviews}`);
          logger.debug(`   - Comments: ${repoActivity.comments}`);
          logger.debug(`   - Total Activity: ${totalActivity}`);
          
          if (filters?.minActivity && totalActivity < filters.minActivity) {
            logger.debug(`❌ Filtered out ${repoFullName}: total activity ${totalActivity} < minimum ${filters.minActivity}`);
            return { filtered: true, reason: 'minActivity' };
          }

          logger.debug(`✅ Repository ${repoFullName} included: ${totalActivity} activities`);
          return { 
            filtered: false, 
            repoActivity, 
            owner, 
            totalActivity 
          };
        } catch (error) {
          logger.debug(`❌ Failed to analyze repository ${repoFullName}: ${error}`);
          return null;
        }
      };

      // Process all repositories in parallel
      const repoPromises = Array.from(repoSet).map(repoFullName => getRepoActivity(repoFullName));
      const repoResults = await Promise.allSettled(repoPromises);

      for (const result of repoResults) {
        if (result.status === 'fulfilled' && result.value) {
          if (result.value.filtered) {
            filteredOutRepos++;
          } else if (result.value.repoActivity) {
            repositories.push(result.value.repoActivity);
            organizations.add(result.value.owner);
            processedRepos++;

            totalCommits += result.value.repoActivity.commits;
            totalIssues += result.value.repoActivity.issues;
            totalPullRequests += result.value.repoActivity.pullRequests;
            totalReviews += result.value.repoActivity.reviews;
            totalComments += result.value.repoActivity.comments;
          }
        }
      }

      // Sort repositories by total activity
      repositories.sort((a, b) => {
        const aTotal = a.commits + a.issues + a.pullRequests + a.reviews + a.comments;
        const bTotal = b.commits + b.issues + b.pullRequests + b.reviews + b.comments;
        return bTotal - aTotal;
      });

      // Estimate LLM calls needed
      const estimatedLLMCalls = this.estimateLLMCalls(repositories, totalCommits, totalIssues + totalPullRequests);

      const discovery: DeveloperDiscovery = {
        username: scope.username,
        totalRepositories: repositories.length,
        totalCommits,
        totalIssues,
        totalPullRequests,
        totalReviews,
        totalComments,
        repositories,
        organizations: Array.from(organizations),
        estimatedLLMCalls,
      };

      logger.info(`📈 GitHub Discovery Summary:`);
      logger.info(`   - Repositories discovered from events: ${repoSet.size}`);
      logger.info(`   - Repositories processed: ${processedRepos}`);
      logger.info(`   - Repositories filtered out: ${filteredOutRepos}`);
      logger.info(`   - Final repositories included: ${repositories.length}`);
      logger.info(`   - Total commits: ${totalCommits}`);
      logger.info(`   - Total issues: ${totalIssues}`);
      logger.info(`   - Total pull requests: ${totalPullRequests}`);
      logger.info(`   - Total reviews: ${totalReviews}`);
      logger.info(`   - Total comments: ${totalComments}`);
      
      return discovery;
    } catch (error) {
      logger.error(`Failed to discover user activity: ${error}`);
      throw error;
    }
  }

  private async getUserEvents(username: string, days: number): Promise<any[]> {
    if (!this.octokit) throw new Error('Octokit not initialized');

    const events: any[] = [];
    let page = 1;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      while (page <= 10) { // Limit to 10 pages (300 events max)
        const response = await this.octokit.rest.activity.listEventsForAuthenticatedUser({
          username,
          per_page: 30,
          page,
        });

        if (response.data.length === 0) break;

        // Filter events within our time range
        const recentEvents = response.data.filter((event: any) => 
          new Date(event.created_at) >= since
        );

        events.push(...recentEvents);

        // If we got events older than our time range, we can stop
        if (recentEvents.length < response.data.length) break;

        page++;
      }
    } catch (error: any) {
      // If we can't get user events, fall back to public events
      if (error.status === 404 || error.status === 403) {
        logger.debug('Falling back to public events');
        return this.getPublicUserEvents(username, days);
      }
      throw error;
    }

    return events;
  }

  private async getPublicUserEvents(username: string, days: number): Promise<any[]> {
    if (!this.octokit) throw new Error('Octokit not initialized');

    const events: any[] = [];
    let page = 1;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      while (page <= 10) {
        const response = await this.octokit.rest.activity.listPublicEventsForUser({
          username,
          per_page: 30,
          page,
        });

        if (response.data.length === 0) break;

        const recentEvents = response.data.filter((event: any) => 
          new Date(event.created_at) >= since
        );

        events.push(...recentEvents);

        if (recentEvents.length < response.data.length) break;

        page++;
      }
    } catch (error) {
      logger.warn(`Failed to get public events for ${username}: ${error}`);
      // Return empty array if we can't get any events
      return [];
    }

    return events;
  }

  private async getRepositoryActivity(
    owner: string,
    repo: string,
    username: string,
    since: Date
  ): Promise<RepositoryActivity> {
    if (!this.octokit) throw new Error('Octokit not initialized');

    let commits = 0;
    let issues = 0;
    let pullRequests = 0;
    let reviews = 0;
    let comments = 0;
    let isPrivate = false;
    let primaryLanguage: string | undefined;
    let lastActivityDate = since.toISOString();

    try {
      // Get repository info
      const repoInfo = await this.octokit.rest.repos.get({ owner, repo });
      isPrivate = repoInfo.data.private;
      primaryLanguage = repoInfo.data.language || undefined;

      // Count commits
      try {
        logger.debug(`🔍 GitHub API: Searching for commits by author "${username}" in ${owner}/${repo} since ${since.toISOString()}`);
        const commitsResponse = await this.octokit.rest.repos.listCommits({
          owner,
          repo,
          author: username,
          since: since.toISOString(),
          per_page: 100,
        });
        commits = commitsResponse.data.length;
        logger.debug(`📊 GitHub API: Found ${commits} commits for author "${username}" in ${owner}/${repo}`);
        
        if (commitsResponse.data.length > 0) {
          lastActivityDate = commitsResponse.data[0].commit.author?.date || lastActivityDate;
          logger.debug(`📝 Sample commits found for ${username}:`);
          
          // Check commit significance for discovery insights
          let significantCommits = 0;
          let insignificantCommits = 0;
          
          commitsResponse.data.forEach((commit: any, index: number) => {
            const message = commit.commit.message;
            const isSignificant = this.isSignificantCommit(message);
            
            if (index < 3) {
              const significanceIcon = isSignificant ? '✅' : '❌';
              logger.debug(`   ${index + 1}. ${significanceIcon} ${commit.sha.substring(0, 8)} - "${message}" by ${commit.commit.author?.name}`);
            }
            
            if (isSignificant) {
              significantCommits++;
            } else {
              insignificantCommits++;
            }
          });
          
          logger.debug(`📊 Commit significance analysis for ${owner}/${repo}:`);
          logger.debug(`   - Total commits: ${commitsResponse.data.length}`);
          logger.debug(`   - Significant commits: ${significantCommits}`);
          logger.debug(`   - Insignificant commits: ${insignificantCommits}`);
          
          if (significantCommits === 0) {
            logger.warn(`⚠️ No significant commits found for ${username} in ${owner}/${repo} - all commits filtered as insignificant`);
          }
        } else {
          logger.debug(`⚠️ No commits found for author "${username}" in ${owner}/${repo} since ${since.toISOString()}`);
        }
      } catch (error) {
        logger.debug(`❌ Failed to get commits for ${owner}/${repo}: ${error}`);
      }

      // Count issues
      try {
        const issuesResponse = await this.octokit.rest.issues.listForRepo({
          owner,
          repo,
          creator: username,
          since: since.toISOString(),
          state: 'all',
          per_page: 100,
        });
        issues = issuesResponse.data.filter((issue: any) => !issue.pull_request).length;
      } catch (error) {
        logger.debug(`Failed to get issues for ${owner}/${repo}: ${error}`);
      }

      // Count pull requests
      try {
        const prsResponse = await this.octokit.rest.pulls.list({
          owner,
          repo,
          state: 'all',
          per_page: 100,
        });
        pullRequests = prsResponse.data.filter(
          (pr: any) => pr.user?.login === username && new Date(pr.created_at) >= since
        ).length;
      } catch (error) {
        logger.debug(`Failed to get PRs for ${owner}/${repo}: ${error}`);
      }

      // Count reviews and comments would require more API calls
      // For now, we'll estimate or skip to keep discovery fast

    } catch (error) {
      logger.debug(`Failed to get repository info for ${owner}/${repo}: ${error}`);
    }

    return {
      fullName: `${owner}/${repo}`,
      owner,
      name: repo,
      commits,
      issues,
      pullRequests,
      reviews,
      comments,
      isPrivate,
      primaryLanguage,
      lastActivityDate,
    };
  }

  private estimateLLMCalls(repositories: RepositoryActivity[], totalCommits: number, totalSocialActivities: number): number {
    // Rough estimation:
    // - 1 LLM call per 5-10 commits (code analysis)
    // - 1 LLM call per developer with significant social activity per repo
    const codeAnalysisCalls = Math.ceil(totalCommits / 7);
    const socialAnalysisCalls = repositories.filter(repo => 
      (repo.issues + repo.pullRequests + repo.reviews + repo.comments) >= 2
    ).length;

    return codeAnalysisCalls + socialAnalysisCalls;
  }

}