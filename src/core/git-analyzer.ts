import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs-extra';
import path from 'path';
import tmp from 'tmp';
import { GitCommit, GitContribution } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { RepositoryError, GitAnalysisError, ErrorHandler } from '../utils/error-handler.js';

export class GitAnalyzer {
  private git: SimpleGit;
  private repoPath: string = '';

  constructor() {
    this.git = simpleGit();
  }

  async cloneRepository(repoUrl: string): Promise<string> {
    return ErrorHandler.wrapAsync(
      async () => {
        // Generate unique prefix for parallel operations to prevent conflicts
        const uniqueId = Math.random().toString(36).substring(2, 15);
        const tempDir = tmp.dirSync({ prefix: `devscorer-${uniqueId}-`, unsafeCleanup: true });
        this.repoPath = tempDir.name;

        logger.info('Cloning repository', { repository: repoUrl, destination: this.repoPath });

        try {
          await this.git.clone(repoUrl, this.repoPath);
          this.git = simpleGit(this.repoPath);
          logger.info('Successfully cloned repository', { repository: repoUrl, path: this.repoPath });
          return this.repoPath;
        } catch (error) {
          throw new RepositoryError(`Failed to clone repository: ${repoUrl}`, {
            repository: repoUrl,
            destination: this.repoPath,
            originalError: error,
          });
        }
      },
      'clone-repository',
      { repository: repoUrl },
    );
  }

  async getRecentContributions(days: number = 7): Promise<GitContribution[]> {
    if (!this.repoPath) {
      throw new GitAnalysisError('Repository not cloned. Call cloneRepository first.');
    }

    return ErrorHandler.wrapAsync(
      async () => {
        // Use relative date syntax which is more reliable across timezones
        const sinceDateStr = `${days} days ago`;

        logger.info('Analyzing contributions', { days, since: sinceDateStr });

        try {
          // Use raw git command for better date handling
          // Look for individual commits (non-merge commits are more common in modern workflows)
          const gitLogCommand = [
            'log',
            `--since=${sinceDateStr}`,
            '--pretty=format:%H|%ai|%s|%an|%ae',
            '--no-merges', // Focus on individual commits rather than merge commits
          ];
          
          logger.debug(`📋 Executing git command: git ${gitLogCommand.join(' ')}`);
          const logResult = await this.git.raw(gitLogCommand);

          const contributions: GitContribution[] = [];
          const commitLines = logResult
            .trim()
            .split('\n')
            .filter(line => line.length > 0);

          logger.info(`📊 Git log analysis results:`);
          logger.info(`   - Command: git ${gitLogCommand.join(' ')}`);
          logger.info(`   - Raw output length: ${logResult.length} chars`);
          logger.info(`   - Total commit lines found: ${commitLines.length}`);
          
          if (commitLines.length === 0) {
            logger.warn(`⚠️ No commits found with git log since ${sinceDateStr}`);
            logger.debug(`Raw git log output: "${logResult}"`);
          } else {
            logger.debug(`📝 Sample commit lines (first 3):`);
            commitLines.slice(0, 3).forEach((line, index) => {
              logger.debug(`   ${index + 1}. ${line}`);
            });
          }

          let significantCount = 0;
          let insignificantCount = 0;

          for (const line of commitLines) {
            const [hash, date, message, authorName, authorEmail] = line.split('|');
            const commit = {
              hash,
              date,
              message,
              author_name: authorName,
              author_email: authorEmail,
            };

            logger.debug(`\n🔍 Processing commit ${hash.substring(0, 8)}:`);
            logger.debug(`   - Author: ${authorName} <${authorEmail}>`);
            logger.debug(`   - Date: ${date}`);
            logger.debug(`   - Message: "${message}"`);

            // Since we're looking at regular commits now, treat them as individual contributions
            // Skip very small commits (like version bumps)
            if (this.isSignificantCommit(commit.message)) {
              significantCount++;
              logger.debug(`✅ Processing as significant contribution`);
              const contribution = await this.analyzeRegularCommit(commit);
              if (contribution) {
                contributions.push(contribution);
                logger.debug(`✅ Contribution added to analysis list`);
              } else {
                logger.debug(`⚠️ Failed to analyze commit as contribution`);
              }
            } else {
              insignificantCount++;
            }
          }

          logger.info(`📈 Commit analysis summary:`);
          logger.info(`   - Total commits found: ${commitLines.length}`);
          logger.info(`   - Significant commits: ${significantCount}`);
          logger.info(`   - Insignificant commits (filtered): ${insignificantCount}`);
          logger.info(`   - Contributions created: ${contributions.length}`);

          logger.info('Found significant commits', {
            count: contributions.length,
            days,
            totalCommits: commitLines.length,
          });
          return contributions;
        } catch (error) {
          throw new GitAnalysisError(`Failed to analyze git history for the last ${days} days`, {
            days,
            since: sinceDateStr,
            repoPath: this.repoPath,
          });
        }
      },
      'get-recent-contributions',
      { days },
    );
  }

  async getCommitContribution(commitHash: string): Promise<GitContribution> {
    if (!this.repoPath) {
      throw new GitAnalysisError('Repository not cloned. Call cloneRepository first.');
    }

    return ErrorHandler.wrapAsync(
      async () => {
        try {
          // Get commit details
          const commitInfo = await this.git.raw([
            'log',
            '-1',
            '--pretty=format:%H|%ai|%s|%an|%ae',
            commitHash,
          ]);

          const [hash, date, message, authorName, authorEmail] = commitInfo.trim().split('|');
          const commit = {
            hash,
            date,
            message,
            author_name: authorName,
            author_email: authorEmail,
          };

          const contribution = await this.analyzeRegularCommit(commit);
          if (!contribution) {
            throw new GitAnalysisError(`Failed to analyze commit ${commitHash}`);
          }

          return contribution;
        } catch (error) {
          throw new GitAnalysisError(`Failed to get commit contribution for ${commitHash}`, {
            commitHash,
            repoPath: this.repoPath,
          });
        }
      },
      'get-commit-contribution',
      { commitHash },
    );
  }

  private isMergeCommit(message: string): boolean {
    const mergePatterns = [/^Merge pull request/, /^Merge branch/, /^Merge remote-tracking branch/, /^Merged in/];

    return mergePatterns.some(pattern => pattern.test(message));
  }

  private isSignificantCommit(message: string): boolean {
    logger.debug(`🔍 Evaluating commit significance: "${message}"`);
    
    // Skip very small or automated commits
    const skipPatterns = [
      { pattern: /^version bump/i, name: 'version bump' },
      { pattern: /^bump version/i, name: 'bump version' },
      { pattern: /^release/i, name: 'release' },
      { pattern: /^\d+\.\d+\.\d+$/, name: 'version number only' },
      { pattern: /^update package\.json/i, name: 'update package.json' },
      { pattern: /^update changelog/i, name: 'update changelog' },
      { pattern: /^update readme/i, name: 'update readme' },
      { pattern: /^fix typo/i, name: 'fix typo' },
      { pattern: /^formatting/i, name: 'formatting' },
      { pattern: /^lint/i, name: 'lint' },
      { pattern: /^chore:/i, name: 'chore prefix' },
    ];

    for (const { pattern, name } of skipPatterns) {
      if (pattern.test(message)) {
        logger.debug(`❌ Commit filtered out: matches "${name}" pattern`);
        return false;
      }
    }

    // Must have reasonable length
    if (message.length <= 10) {
      logger.debug(`❌ Commit filtered out: message too short (${message.length} chars, need >10)`);
      return false;
    }

    logger.debug(`✅ Commit is significant`);
    return true;
  }

  private async analyzeMergeCommit(commit: any): Promise<GitContribution | null> {
    try {
      const branchName = this.extractBranchName(commit.message);
      const mergeCommits = await this.getMergeCommitDetails(commit.hash);
      const diff = await this.getMergeDiff(commit.hash);
      const linesChanged = this.countLinesChanged(diff);
      const projectContext = await this.getProjectContext();

      // Get the pre-commit hash (parent of this commit)
      const preCommitHash = await this.git.raw(['rev-parse', `${commit.hash}~1`]);

      return {
        branch: branchName,
        author: commit.author_name || 'Unknown',
        date: new Date(commit.date),
        commits: mergeCommits,
        diff,
        linesChanged,
        projectContext,
        commitHash: commit.hash,
        preCommitHash: preCommitHash.trim(),
      };
    } catch (error) {
      logger.warn(`Failed to analyze merge commit ${commit.hash}: ${error}`);
      return null;
    }
  }

  private async analyzeRegularCommit(commit: any): Promise<GitContribution | null> {
    try {
      // For regular commits, we treat the commit message as the "branch" name
      const branchName = commit.message.substring(0, 50); // Truncate for readability
      const diff = await this.getCommitDiff(commit.hash);
      const linesChanged = this.countLinesChanged(diff);
      const projectContext = await this.getProjectContext();

      // Get the pre-commit hash (parent of this commit)
      const preCommitHash = await this.git.raw(['rev-parse', `${commit.hash}~1`]);

      // Create a single-commit "merge" for analysis
      const singleCommit: GitCommit = {
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name || 'Unknown',
        date: new Date(commit.date),
        diff,
      };

      return {
        branch: branchName,
        author: commit.author_name || 'Unknown',
        date: new Date(commit.date),
        commits: [singleCommit],
        diff,
        linesChanged,
        projectContext,
        commitHash: commit.hash,
        preCommitHash: preCommitHash.trim(),
      };
    } catch (error) {
      logger.warn(`Failed to analyze commit ${commit.hash}: ${error}`);
      return null;
    }
  }

  private async getCommitDiff(commitHash: string): Promise<string> {
    try {
      const diff = await this.git.diff([`${commitHash}~1`, commitHash]);
      return diff;
    } catch (error) {
      logger.warn(`Failed to get diff for commit ${commitHash}: ${error}`);
      return '';
    }
  }

  private extractBranchName(mergeMessage: string): string {
    const patterns = [/Merge pull request #\d+ from [^/]+\/(.+)/, /Merge branch '([^']+)'/, /Merged in ([^\s]+)/];

    for (const pattern of patterns) {
      const match = mergeMessage.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return 'unknown-branch';
  }

  private async getMergeCommitDetails(mergeHash: string): Promise<GitCommit[]> {
    try {
      const parentHashes = await this.git.raw(['log', '--pretty=%P', '-n', '1', mergeHash]);
      const parents = parentHashes.trim().split(' ');

      if (parents.length < 2) {
        return [];
      }

      const featureBranchParent = parents[1];
      const mainBranchParent = parents[0];

      const commits = await this.git.log({
        from: mainBranchParent,
        to: featureBranchParent,
      });

      return commits.all.map(commit => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name || 'Unknown',
        date: new Date(commit.date),
        diff: '',
      }));
    } catch (error) {
      logger.warn(`Failed to get merge commit details for ${mergeHash}: ${error}`);
      return [];
    }
  }

  private async getMergeDiff(mergeHash: string): Promise<string> {
    try {
      const parentHashes = await this.git.raw(['log', '--pretty=%P', '-n', '1', mergeHash]);
      const parents = parentHashes.trim().split(' ');

      if (parents.length < 2) {
        return '';
      }

      const mainBranchParent = parents[0];
      const featureBranchParent = parents[1];

      const diff = await this.git.diff([`${mainBranchParent}...${featureBranchParent}`]);
      return diff;
    } catch (error) {
      logger.warn(`Failed to get diff for merge ${mergeHash}: ${error}`);
      return '';
    }
  }

  private countLinesChanged(diff: string): number {
    const lines = diff.split('\n');
    let addedLines = 0;
    let deletedLines = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        addedLines++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletedLines++;
      }
    }

    return addedLines + deletedLines;
  }

  private async getProjectContext(): Promise<string> {
    try {
      const context: string[] = [];

      const packageJsonPath = path.join(this.repoPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        const packageJson = await fs.readJson(packageJsonPath);
        context.push(`Project: ${packageJson.name || 'Unknown'}`);
        context.push(`Description: ${packageJson.description || 'No description'}`);

        if (packageJson.dependencies) {
          const mainDeps = Object.keys(packageJson.dependencies).slice(0, 10);
          context.push(`Main dependencies: ${mainDeps.join(', ')}`);
        }
      }

      const readmePath = path.join(this.repoPath, 'README.md');
      if (await fs.pathExists(readmePath)) {
        const readme = await fs.readFile(readmePath, 'utf-8');
        const firstParagraph = readme.split('\n\n')[0];
        context.push(`README excerpt: ${firstParagraph.substring(0, 200)}...`);
      }

      const srcStructure = await this.getDirectoryStructure(path.join(this.repoPath, 'src'));
      if (srcStructure) {
        context.push(`Source structure: ${srcStructure}`);
      }

      return context.join('\n');
    } catch (error) {
      logger.warn(`Failed to get project context: ${error}`);
      return 'Unable to determine project context';
    }
  }

  private async getDirectoryStructure(
    dirPath: string,
    maxDepth: number = 2,
    currentDepth: number = 0,
  ): Promise<string | null> {
    if (currentDepth >= maxDepth || !(await fs.pathExists(dirPath))) {
      return null;
    }

    try {
      const items = await fs.readdir(dirPath);
      const structure: string[] = [];

      for (const item of items.slice(0, 10)) {
        const itemPath = path.join(dirPath, item);
        const stat = await fs.stat(itemPath);

        if (stat.isDirectory()) {
          structure.push(`${item}/`);
        } else {
          structure.push(item);
        }
      }

      return structure.join(', ');
    } catch (error) {
      return null;
    }
  }

  async createPreCommitRepository(commitHash: string): Promise<string> {
    if (!this.repoPath) {
      throw new Error('Repository not cloned. Call cloneRepository first.');
    }

    // Generate unique prefix for parallel operations to prevent conflicts
    const uniqueId = Math.random().toString(36).substring(2, 15);
    const tempDir = tmp.dirSync({ prefix: `precommit-${uniqueId}-`, unsafeCleanup: true });
    const preCommitPath = tempDir.name;

    logger.debug(`Creating pre-commit repository at ${preCommitPath} for commit ${commitHash}`);

    try {
      // Clone the current repository to a new location
      await this.git.clone(this.repoPath, preCommitPath);

      // Switch to the new repository
      const preCommitGit = simpleGit(preCommitPath);

      // Get the parent commit (the state before this commit)
      const preCommitHash = await preCommitGit.raw(['rev-parse', `${commitHash}~1`]);
      const cleanPreCommitHash = preCommitHash.trim();

      // Checkout to the pre-commit state
      await preCommitGit.checkout(cleanPreCommitHash);

      logger.debug(`Pre-commit repository created and checked out to ${cleanPreCommitHash}`);

      // List the files in the pre-commit repository for debugging
      try {
        const files = await this.listRepositoryFiles(preCommitPath);
        logger.debug(
          `📁 Files available in pre-commit repository: ${files.slice(0, 20).join(', ')}${files.length > 20 ? ` (and ${files.length - 20} more)` : ''}`,
        );
      } catch (error) {
        logger.debug(`Could not list pre-commit repository files: ${error}`);
      }

      return preCommitPath;
    } catch (error) {
      logger.error(`Failed to create pre-commit repository: ${error}`);
      throw new Error(`Failed to create pre-commit repository: ${error}`);
    }
  }

  private async listRepositoryFiles(repoPath: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.git')) continue; // Skip git files

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(repoPath, fullPath);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          files.push(relativePath);
        }
      }
    }

    await walk(repoPath);
    return files.sort();
  }

  async cleanup(): Promise<void> {
    if (this.repoPath && (await fs.pathExists(this.repoPath))) {
      try {
        await fs.remove(this.repoPath);
        logger.info(`Cleaned up temporary repository at ${this.repoPath}`);
      } catch (error) {
        logger.warn(`Failed to cleanup repository at ${this.repoPath}: ${error}`);
      }
    }
  }

  getRepoPath(): string {
    return this.repoPath;
  }
}
