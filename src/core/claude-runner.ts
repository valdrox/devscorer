import { Options, query, type SDKMessage } from '@anthropic-ai/claude-code';
import fs from 'fs-extra';
import path from 'path';
import simpleGit from 'simple-git';
import { BusinessPurpose, ClaudeCodeResult, Hint } from '../types/index.js';
import { logger, logPrompt, PromptType } from '../utils/logger.js';
import { claudeCodeLogger } from '../utils/claude-code-logger.js';
import { GitAnalyzer } from './git-analyzer.js';

export class ClaudeRunner {
  private workingDir: string = '';
  private sessionId: string | null = null;

  async runClaudeCode(
    businessPurpose: BusinessPurpose,
    projectContext: string,
    commitHash: string,
    originalDiff: string,
    previousHints: Hint[] = [],
    gitAnalyzer?: GitAnalyzer
  ): Promise<ClaudeCodeResult> {
    logger.info('Running Claude Code with business requirements');

    try {
      // Use the existing repository and checkout pre-commit state
      if (!gitAnalyzer) {
        throw new Error('GitAnalyzer is required for optimized Claude Code execution');
      }

      const repoPath = gitAnalyzer.getRepoPath();
      if (!repoPath) {
        throw new Error('Repository path not available from GitAnalyzer');
      }

      // Checkout to pre-commit state in existing repository
      await this.checkoutPreCommitState(repoPath, commitHash);
      this.workingDir = repoPath;

      let prompt: string;
      const isResumingSession = this.sessionId !== null && previousHints.length > 0;

      if (isResumingSession) {
        // For resumed sessions, just pass the latest hint (no additional context needed)
        const latestHint = previousHints[previousHints.length - 1];
        prompt = latestHint.content;
        logger.debug('Resuming Claude Code session with new hint');
      } else {
        // First attempt - build full prompt
        prompt = this.buildPrompt(businessPurpose, projectContext, originalDiff, previousHints);
        logger.debug('Starting new Claude Code session');
      }

      const result = await this.executeClaudeCode(prompt, repoPath, isResumingSession);

      return {
        code: result.code,
        success: result.success,
        errors: result.errors,
        warnings: result.warnings,
      };
    } catch (error) {
      logger.error(`Claude Code execution failed: ${error}`);
      return {
        code: '',
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private buildPrompt(
    businessPurpose: BusinessPurpose,
    projectContext: string,
    originalDiff: string,
    previousHints: Hint[]
  ): string {
    logger.debug(
      `Building Claude Code prompt with ${businessPurpose.requirements.length} requirements and ${previousHints.length} hints`
    );

    let prompt = `

WORKING DIRECTORY REQUIREMENTS:
- Must contain .git directory
- Must be the cloned repository for analysis
- If directory seems wrong, immediately exit with error message

IMMEDIATE TASK: Implement the following feature requirements directly in the existing codebase.

REQUIREMENTS TO IMPLEMENT:
${businessPurpose.requirements.map((req, idx) => `${idx + 1}. ${req}`).join('\n')}

BUSINESS GOAL: ${businessPurpose.summary}

TECHNICAL CONTEXT: ${businessPurpose.technicalContext}

WORKING DIRECTORY SCOPE:
- Focus only on source files and avoid exploring node_modules, .git, or build directories

`;

    // Only include hints for the first attempt - subsequent attempts will be handled via session resume
    if (previousHints.length > 0) {
      prompt += `\n\nCRITICAL HINTS (incorporate these):
${previousHints.map((hint, idx) => `${idx + 1}. ${hint.content}`).join('\n')}`;
    }

    prompt += '\n\nSTART IMPLEMENTING NOW';

    return prompt;
  }

  private extractModifiedFiles(diff: string): string {
    const lines = diff.split('\n');
    const modifiedFiles: string[] = [];

    for (const line of lines) {
      if (line.startsWith('diff --git a/')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          const fileName = match[2];
          if (!modifiedFiles.includes(fileName)) {
            modifiedFiles.push(fileName);
          }
        }
      }
    }

    if (modifiedFiles.length === 0) {
      return 'No specific files identified - examine the codebase structure';
    }

    return modifiedFiles.map(file => `- ${file}`).join('\n');
  }

  private async executeClaudeCode(
    prompt: string,
    workDir: string,
    isResumingSession: boolean = false
  ): Promise<{
    code: string;
    success: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const messages: SDKMessage[] = [];

    try {
      const abortController = new AbortController();

      // Set a timeout for the operation
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 300000); // 5 minutes

      logger.debug(`🔧 Executing Claude Code in directory: ${workDir}`);
      logger.debug(`🔧 Current process.cwd(): ${process.cwd()}`);
      logger.debug(`🔧 Absolute workDir path: ${path.resolve(workDir)}`);

      // Verify the working directory exists and log its contents
      try {
        const workDirExists = await fs.pathExists(workDir);
        if (!workDirExists) {
          throw new Error(`Working directory does not exist: ${workDir}`);
        }

        // Log the contents of the working directory to verify scope
        const dirContents = await fs.readdir(workDir);
        logger.debug(
          `📁 Working directory contents: ${dirContents.slice(0, 10).join(', ')}${dirContents.length > 10 ? ` (and ${dirContents.length - 10} more)` : ''}`
        );
      } catch (error) {
        logger.error(`❌ Working directory verification failed: ${error}`);
        throw error;
      }
      logPrompt(PromptType.CLAUDE_CODE_INITIAL, prompt);

      const queryOptions: Options = {
        maxTurns: 30, // Increased to allow more complex implementations
        cwd: workDir,
        permissionMode: 'acceptEdits',
        allowedTools: [
          'Bash',
          'Edit',
          'Glob',
          'Grep',
          'LS',
          'MultiEdit',
          'NotebookEdit',
          'NotebookRead',
          'Read',
          'Task',
          'TodoWrite',
          'WebFetch',
          'WebSearch',
          'Write',
        ],
      };

      // Add resume option if we're resuming a session
      if (isResumingSession && this.sessionId) {
        queryOptions.resume = this.sessionId;
        logger.debug(`Resuming Claude Code session: ${this.sessionId}`);
      }

      for await (const message of query({
        prompt,
        abortController,
        options: queryOptions,
      })) {
        messages.push(message);

        // Capture session ID from any message (if not already captured)
        if (!this.sessionId && 'session_id' in message) {
          this.sessionId = message.session_id;
          logger.debug(`Captured Claude Code session ID: ${this.sessionId}`);
        }

        // Log detailed progress for debugging
        claudeCodeLogger.logMessage(message);
      }

      clearTimeout(timeoutId);

      // Find the result message
      const resultMessage = messages.find(m => m.type === 'result');

      if (!resultMessage || resultMessage.type !== 'result') {
        throw new Error('No result message received from Claude Code');
      }

      if (resultMessage.subtype === 'success') {
        // Extract generated diff from the working directory
        logger.debug('✅ Claude Code completed successfully, extracting generated diff...');
        const generatedDiff = await this.extractGeneratedDiff(workDir);
        logger.debug(`📄 Generated diff (${generatedDiff.length} chars): ${generatedDiff}`);

        return {
          code: generatedDiff,
          success: true,
          errors: [],
          warnings: [],
        };
      } else {
        // Handle error cases
        return {
          code: '',
          success: false,
          errors: [`Claude Code failed: ${resultMessage.subtype}`],
          warnings: [],
        };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          code: '',
          success: false,
          errors: ['Claude Code execution timed out'],
          warnings: [],
        };
      }

      logger.error(`Claude Code SDK error: ${error}`);
      return {
        code: '',
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
      };
    }
  }

  private async extractGeneratedDiff(workDir: string): Promise<string> {
    try {
      // Create a git instance for the working directory
      const git = simpleGit(workDir);

      // Verify this is a git repository
      const dirExists = await fs.pathExists(workDir);
      if (!dirExists) {
        throw new Error(`Working directory does not exist: ${workDir}`);
      }

      const hasGitDir = await fs.pathExists(path.join(workDir, '.git'));
      if (!hasGitDir) {
        throw new Error(`Working directory is not a git repository: ${workDir}`);
      }

      logger.debug(`🔍 Extracting diff from working directory: ${workDir}`);

      // STEP 1: Check git status to understand current state
      const status = await git.status();
      logger.debug('🔍 Git status before staging:');
      logger.debug(`  📄 Modified files: ${status.modified.length > 0 ? status.modified.join(', ') : 'none'}`);
      logger.debug(`  📄 Untracked files: ${status.not_added.length > 0 ? status.not_added.join(', ') : 'none'}`);
      logger.debug(`  📄 Staged files: ${status.staged.length > 0 ? status.staged.join(', ') : 'none'}`);
      logger.debug(`  📄 Deleted files: ${status.deleted.length > 0 ? status.deleted.join(', ') : 'none'}`);

      // STEP 2: Determine if there are any changes to process
      const hasChanges =
        status.modified.length > 0 ||
        status.not_added.length > 0 ||
        status.deleted.length > 0 ||
        status.staged.length > 0;

      if (!hasChanges) {
        throw new Error('No changes detected in working directory (no modified, untracked, staged, or deleted files)');
      }

      // STEP 3: Stage all changes explicitly for proper diff generation
      logger.debug('📦 Staging all changes for diff generation...');

      // Add all modified and untracked files
      if (status.modified.length > 0 || status.not_added.length > 0) {
        await git.add('.');
        logger.debug(`✅ Added ${status.modified.length + status.not_added.length} files to staging area`);
      }

      // Handle deleted files by removing them from the index
      if (status.deleted.length > 0) {
        for (const deletedFile of status.deleted) {
          await git.rm(deletedFile);
        }
        logger.debug(`✅ Removed ${status.deleted.length} deleted files from index`);
      }

      // STEP 4: Generate diff from staged changes against HEAD
      logger.debug('📊 Generating git diff from staged changes...');
      const stagedDiff = await git.diff(['--cached']);
      logger.debug(`📊 Staged diff length: ${stagedDiff.length} characters`);

      if (!stagedDiff || stagedDiff.trim().length === 0) {
        // If no staged diff, check if we already had staged changes from before
        const preExistingStagedDiff = await git.diff(['--cached', 'HEAD']);
        if (preExistingStagedDiff && preExistingStagedDiff.trim().length > 0) {
          logger.debug('✅ Using pre-existing staged changes');
          return preExistingStagedDiff;
        }

        throw new Error('No staged changes found after adding files to staging area');
      }

      logger.debug(`✅ Successfully extracted staged git diff with ${stagedDiff.split('\n').length} lines`);
      return stagedDiff;
    } catch (error) {
      logger.error(`Failed to extract git diff: ${error}`);
      throw new Error(`Failed to extract git diff: ${error}`);
    }
  }

  async cleanup(): Promise<void> {
    // Reset session ID for next analysis
    if (this.sessionId) {
      logger.debug(`Resetting Claude Code session ID: ${this.sessionId}`);
      this.sessionId = null;
    }

    // Note: Working directory cleanup is handled by the caller (main analysis loop)
    // since Claude Code sessions need to persist across hint attempts in the same directory
  }

  async runAnalysis(prompt: string): Promise<string> {
    try {
      logger.debug('Running LLM analysis for GitHub evaluation');

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 60000); // 60 second timeout

      const messages: SDKMessage[] = [];

      for await (const message of query({
        prompt,
        abortController,
        options: {
          maxTurns: 1,
          permissionMode: 'acceptEdits',
          allowedTools: [
            'Bash',
            'Edit',
            'Glob',
            'Grep',
            'LS',
            'MultiEdit',
            'NotebookEdit',
            'NotebookRead',
            'Read',
            'Task',
            'TodoWrite',
            'WebFetch',
            'WebSearch',
            'Write',
          ],
        },
      })) {
        messages.push(message);
      }

      clearTimeout(timeout);

      // Extract text response from the last assistant message
      const assistantMessages = messages.filter(m => m.type === 'assistant');
      if (assistantMessages.length === 0) {
        throw new Error('No response from LLM');
      }

      const lastMessage = assistantMessages[assistantMessages.length - 1];
      const content = lastMessage.message.content;

      if (Array.isArray(content)) {
        const textContent = content.find(c => c.type === 'text');
        if (textContent && 'text' in textContent) {
          return textContent.text;
        }
      }

      throw new Error('No text content in LLM response');
    } catch (error) {
      logger.error(`GitHub analysis LLM call failed: ${error}`);
      throw new Error(`LLM analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async isClaudeCodeAvailable(): Promise<boolean> {
    try {
      const testAbortController = new AbortController();
      testAbortController.abort(); // Immediately abort to test availability

      const testQuery = query({
        prompt: 'test',
        abortController: testAbortController,
        options: {
          maxTurns: 1,
        },
      });

      // Try to start the query (it will be aborted immediately)
      await testQuery.next();
      return true;
    } catch (error) {
      // If it's an abort error, that means the SDK is available
      if (error instanceof Error && error.name === 'AbortError') {
        return true;
      }

      logger.debug(`Claude Code SDK not available: ${error}`);
      return false;
    }
  }

  private async checkoutPreCommitState(repoPath: string, commitHash: string): Promise<void> {
    try {
      const git = simpleGit(repoPath);

      // Get the parent commit (the state before this commit)
      const preCommitHash = await git.raw(['rev-parse', `${commitHash}~1`]);
      const cleanPreCommitHash = preCommitHash.trim();

      // Checkout to the pre-commit state
      await git.checkout(cleanPreCommitHash);

      logger.debug(`Checked out repository to pre-commit state: ${cleanPreCommitHash}`);
    } catch (error) {
      logger.error(`Failed to checkout pre-commit state: ${error}`);
      throw new Error(`Failed to checkout pre-commit state: ${error}`);
    }
  }
}
