import simpleGit, { SimpleGit, LogOptions } from 'simple-git';
import fs from 'fs-extra';
import path from 'path';
import tmp from 'tmp';
import { GitCommit, GitMerge } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class GitAnalyzer {
  private git: SimpleGit;
  private repoPath: string = '';

  constructor() {
    this.git = simpleGit();
  }

  async cloneRepository(repoUrl: string): Promise<string> {
    const tempDir = tmp.dirSync({ prefix: 'devscorer-', unsafeCleanup: true });
    this.repoPath = tempDir.name;
    
    logger.info(`Cloning repository ${repoUrl} to ${this.repoPath}`);
    
    try {
      await this.git.clone(repoUrl, this.repoPath);
      this.git = simpleGit(this.repoPath);
      logger.info(`Successfully cloned repository to ${this.repoPath}`);
      return this.repoPath;
    } catch (error) {
      logger.error(`Failed to clone repository: ${error}`);
      throw new Error(`Failed to clone repository: ${error}`);
    }
  }

  async getRecentMerges(days: number = 7): Promise<GitMerge[]> {
    if (!this.repoPath) {
      throw new Error('Repository not cloned. Call cloneRepository first.');
    }

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    logger.info(`Analyzing merges from the last ${days} days`);

    try {
      // Use raw git command for better date handling
      // Look for both merge commits and regular commits that might be squashed merges
      const sinceDateStr = sinceDate.toISOString().split('T')[0];
      const logResult = await this.git.raw([
        'log',
        '--since=' + sinceDateStr,
        '--pretty=format:%H|%ai|%s|%an|%ae',
        '--no-merges' // Actually, let's look at non-merge commits which are more common now
      ]);
      
      const merges: GitMerge[] = [];
      const commitLines = logResult.trim().split('\n').filter(line => line.length > 0);

      for (const line of commitLines) {
        const [hash, date, message, authorName, authorEmail] = line.split('|');
        const commit = {
          hash,
          date,
          message,
          author_name: authorName,
          author_email: authorEmail
        };

        // Since we're looking at regular commits now, treat them as individual contributions
        // Skip very small commits (like version bumps)
        if (this.isSignificantCommit(commit.message)) {
          const merge = await this.analyzeRegularCommit(commit);
          if (merge) {
            merges.push(merge);
          }
        }
      }

      logger.info(`Found ${merges.length} significant commits in the last ${days} days`);
      return merges;
    } catch (error) {
      logger.error(`Failed to get recent merges: ${error}`);
      throw new Error(`Failed to get recent merges: ${error}`);
    }
  }

  private isMergeCommit(message: string): boolean {
    const mergePatterns = [
      /^Merge pull request/,
      /^Merge branch/,
      /^Merge remote-tracking branch/,
      /^Merged in/
    ];
    
    return mergePatterns.some(pattern => pattern.test(message));
  }

  private isSignificantCommit(message: string): boolean {
    // Skip very small or automated commits
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
      /^chore:/i
    ];

    if (skipPatterns.some(pattern => pattern.test(message))) {
      return false;
    }

    // Must have reasonable length
    return message.length > 10;
  }

  private async analyzeMergeCommit(commit: any): Promise<GitMerge | null> {
    try {
      const branchName = this.extractBranchName(commit.message);
      const mergeCommits = await this.getMergeCommitDetails(commit.hash);
      const diff = await this.getMergeDiff(commit.hash);
      const linesChanged = this.countLinesChanged(diff);
      const projectContext = await this.getProjectContext();

      return {
        branch: branchName,
        author: commit.author_name || 'Unknown',
        date: new Date(commit.date),
        commits: mergeCommits,
        diff: diff,
        linesChanged: linesChanged,
        projectContext: projectContext
      };
    } catch (error) {
      logger.warn(`Failed to analyze merge commit ${commit.hash}: ${error}`);
      return null;
    }
  }

  private async analyzeRegularCommit(commit: any): Promise<GitMerge | null> {
    try {
      // For regular commits, we treat the commit message as the "branch" name
      const branchName = commit.message.substring(0, 50); // Truncate for readability
      const diff = await this.getCommitDiff(commit.hash);
      const linesChanged = this.countLinesChanged(diff);
      const projectContext = await this.getProjectContext();

      // Create a single-commit "merge" for analysis
      const singleCommit: GitCommit = {
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name || 'Unknown',
        date: new Date(commit.date),
        diff: diff
      };

      return {
        branch: branchName,
        author: commit.author_name || 'Unknown',
        date: new Date(commit.date),
        commits: [singleCommit],
        diff: diff,
        linesChanged: linesChanged,
        projectContext: projectContext
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
    const patterns = [
      /Merge pull request #\d+ from [^\/]+\/(.+)/,
      /Merge branch '([^']+)'/,
      /Merged in ([^\s]+)/
    ];

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
        diff: ''
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

  private async getDirectoryStructure(dirPath: string, maxDepth: number = 2, currentDepth: number = 0): Promise<string | null> {
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

  async cleanup(): Promise<void> {
    if (this.repoPath && await fs.pathExists(this.repoPath)) {
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