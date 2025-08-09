import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import fs from 'fs-extra';
import path from 'path';
import simpleGit from 'simple-git';
import { BusinessPurpose, ClaudeCodeResult, Hint } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { tempManager } from '../utils/temp-manager.js';

export class ClaudeRunner {
  private workingDir: string = '';
  private sessionId: string | null = null;

  async runClaudeCode(
    businessPurpose: BusinessPurpose,
    projectContext: string,
    preCommitRepoPath: string,
    originalDiff: string,
    previousHints: Hint[] = []
  ): Promise<ClaudeCodeResult> {
    logger.info('Running Claude Code with business requirements');

    try {
      // Use the pre-commit repository as the working directory
      this.workingDir = preCommitRepoPath;
      
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

      const result = await this.executeClaudeCode(prompt, preCommitRepoPath, isResumingSession);

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

    let prompt = `CRITICAL: First verify you're in the correct repository:
1. Run 'pwd' to check your current directory
2. Run 'ls -la' to verify this is the right repository  
3. Look for key files that indicate this is the target repository
4. If you're in the wrong directory, STOP and throw an error immediately

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

    prompt += `\n\nSTART IMPLEMENTING NOW - but remember to verify directory first!`;

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
      logger.debug(`Claude Code prompt: ${prompt}`);

      const queryOptions: any = {
        maxTurns: 30, // Increased to allow more complex implementations
        cwd: workDir,
        permissionMode: 'bypassPermissions',
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
        if (message.type === 'assistant') {
          const content = message.message.content;
          if (Array.isArray(content) && content.length > 0) {
            const textContent = content.find(c => c.type === 'text');
            if (textContent && 'text' in textContent) {
              logger.debug(`Claude Code: ${textContent.text}`);
            }
          }
        } else if (message.type === 'user') {
          const content = message.message.content;
          if (Array.isArray(content) && content.length > 0) {
            const textContent = content.find(c => c.type === 'text');
            if (textContent && 'text' in textContent) {
              logger.debug(`Claude Code User: ${textContent.text}`);
            }
          } else if (typeof content === 'string') {
            logger.debug(`Claude Code User: ${content}`);
          } else {
            logger.debug('Claude Code: User input received (non-text content)');
          }
        } else if (message.type === 'result') {
          logger.debug(`Claude Code completed with ${message.num_turns} turns, result: ${message.subtype}`);
        } else if (message.type === 'system') {
          logger.debug(`Claude Code: System message - ${message.subtype}`);
        }
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

      // First, let's debug the actual directory contents
      logger.debug(`🔍 Investigating working directory: ${workDir}`);
      const dirExists = await fs.pathExists(workDir);
      logger.debug(`📁 Working directory exists: ${dirExists}`);

      if (dirExists) {
        const dirContents = await fs.readdir(workDir);
        logger.debug(`📁 Directory contents: ${dirContents.join(', ')}`);

        // Check if this looks like the right repository by looking for key files
        const hasGit = dirContents.includes('.git');
        const hasSource = dirContents.includes('source');
        const hasPackageJson = dirContents.includes('package.json');
        logger.debug(
          `📁 Repository indicators - .git: ${hasGit}, source/: ${hasSource}, package.json: ${hasPackageJson}`
        );
      }

      // Check git status for debugging
      const status = await git.status();
      logger.debug('🔍 Git status in working directory:');
      logger.debug(`  📄 Modified files: ${status.modified.length > 0 ? status.modified.join(', ') : 'none'}`);
      logger.debug(`  📄 Untracked files: ${status.not_added.length > 0 ? status.not_added.join(', ') : 'none'}`);
      logger.debug(`  📄 Staged files: ${status.staged.length > 0 ? status.staged.join(', ') : 'none'}`);
      logger.debug(`  📄 Deleted files: ${status.deleted.length > 0 ? status.deleted.join(', ') : 'none'}`);

      // Get the diff of all changes made by Claude Code
      const diff = await git.diff();
      logger.debug(`📊 Raw git diff length: ${diff.length} characters`);

      if (!diff || diff.trim().length === 0) {
        logger.warn('⚠️ No unstaged changes detected, trying alternative approaches...');

        // Check for untracked files and add them
        if (status.not_added.length > 0) {
          logger.debug(`📄 Found ${status.not_added.length} untracked files: ${status.not_added.join(', ')}`);

          // Add untracked files to see them in diff
          await git.add('.');
          const diffWithUntracked = await git.diff(['--cached']);
          logger.debug(`📊 Cached git diff length: ${diffWithUntracked.length} characters`);

          if (diffWithUntracked && diffWithUntracked.trim().length > 0) {
            logger.debug('✅ Successfully captured diff including untracked files');
            return diffWithUntracked;
          }
        }

        // Also check if there are already staged changes
        const stagedDiff = await git.diff(['--cached']);
        logger.debug(`📊 Already staged diff length: ${stagedDiff.length} characters`);

        if (stagedDiff && stagedDiff.trim().length > 0) {
          logger.debug('✅ Found staged changes, using those');
          return stagedDiff;
        }

        // If still no changes, try diff with HEAD to see all changes from the initial state
        const diffFromHead = await git.diff(['HEAD']);
        logger.debug(`📊 Diff from HEAD length: ${diffFromHead.length} characters`);

        if (diffFromHead && diffFromHead.trim().length > 0) {
          logger.debug('✅ Found changes from HEAD, using those');
          return diffFromHead;
        }

        // As a last resort, try to manually check specific files that Claude mentioned
        logger.warn('🔍 No git changes detected, attempting manual file comparison...');
        const manualDiff = await this.generateManualDiff(workDir);
        if (manualDiff) {
          logger.debug('✅ Generated manual diff from file changes');
          return manualDiff;
        }

        throw new Error('No changes generated by Claude Code (no diff output from any method)');
      }

      logger.debug(`✅ Successfully extracted git diff with ${diff.split('\n').length} lines`);
      return diff;
    } catch (error) {
      logger.error(`Failed to extract git diff: ${error}`);
      throw new Error(`Failed to extract git diff: ${error}`);
    }
  }

  private async generateManualDiff(workDir: string): Promise<string | null> {
    try {
      // This is a fallback to manually check common file locations that might have been modified
      const git = simpleGit(workDir);

      // Get the original state by checking what files exist
      const allFiles = await this.getAllFilesRecursively(workDir);
      logger.debug(`🔍 Found ${allFiles.length} files in working directory`);

      // For each file, check if it differs from the git HEAD
      const changedFiles: string[] = [];

      for (const file of allFiles) {
        try {
          const relativePath = path.relative(workDir, file);
          // Skip .git directory files
          if (relativePath.startsWith('.git/')) continue;

          // Check if this file exists in git and if it's different
          const headContent = await git.show([`HEAD:${relativePath}`]).catch(() => null);
          const currentContent = await fs.readFile(file, 'utf-8');

          if (headContent !== null && headContent !== currentContent) {
            changedFiles.push(relativePath);
            logger.debug(`📄 Detected manual change in: ${relativePath}`);
          } else if (headContent === null) {
            // This is a new file
            changedFiles.push(relativePath);
            logger.debug(`📄 Detected new file: ${relativePath}`);
          }
        } catch (error) {
          // Ignore individual file errors
        }
      }

      if (changedFiles.length > 0) {
        logger.debug(`📄 Manual detection found ${changedFiles.length} changed files: ${changedFiles.join(', ')}`);

        // Generate a simple diff for these files
        let manualDiff = '';
        for (const file of changedFiles) {
          try {
            const currentContent = await fs.readFile(path.join(workDir, file), 'utf-8');
            manualDiff += `diff --git a/${file} b/${file}\n`;
            manualDiff += `--- a/${file}\n`;
            manualDiff += `+++ b/${file}\n`;
            manualDiff += `@@ -1,1 +1,${currentContent.split('\n').length} @@\n`;

            // Add the content as additions (simplified diff)
            const lines = currentContent.split('\n');
            for (const line of lines) {
              manualDiff += `+${line}\n`;
            }
            manualDiff += '\n';
          } catch (error) {
            logger.debug(`Error generating manual diff for ${file}: ${error}`);
          }
        }

        return manualDiff;
      }

      return null;
    } catch (error) {
      logger.debug(`Manual diff generation failed: ${error}`);
      return null;
    }
  }

  private async getAllFilesRecursively(dir: string): Promise<string[]> {
    const files: string[] = [];

    if (!(await fs.pathExists(dir))) {
      return files;
    }

    const items = await fs.readdir(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory() && item !== 'node_modules' && item !== '.git') {
        const subFiles = await this.getAllFilesRecursively(fullPath);
        files.push(...subFiles);
      } else if (stat.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
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
}
