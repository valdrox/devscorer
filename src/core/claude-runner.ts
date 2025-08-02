import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import fs from 'fs-extra';
import path from 'path';
import { BusinessPurpose, ClaudeCodeResult, Hint } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { tempManager } from '../utils/temp-manager.js';

export class ClaudeRunner {
  private workingDir: string = '';

  async runClaudeCode(
    businessPurpose: BusinessPurpose,
    projectContext: string,
    preCommitRepoPath: string,
    previousHints: Hint[] = []
  ): Promise<ClaudeCodeResult> {
    logger.info('Running Claude Code with business requirements');

    try {
      // Use the pre-commit repository as the working directory
      this.workingDir = preCommitRepoPath;
      const prompt = this.buildPrompt(businessPurpose, projectContext, previousHints);
      
      const result = await this.executeClaudeCode(prompt, preCommitRepoPath);
      
      return {
        code: result.code,
        success: result.success,
        errors: result.errors,
        warnings: result.warnings
      };
    } catch (error) {
      logger.error(`Claude Code execution failed: ${error}`);
      return {
        code: '',
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }


  private buildPrompt(
    businessPurpose: BusinessPurpose,
    projectContext: string,
    previousHints: Hint[]
  ): string {
    logger.debug(`Building Claude Code prompt with ${businessPurpose.requirements.length} requirements and ${previousHints.length} hints`);
    
    let prompt = `IMMEDIATE TASK: Implement the following feature requirements directly in the existing codebase.

REQUIREMENTS TO IMPLEMENT:
${businessPurpose.requirements.map((req, idx) => `${idx + 1}. ${req}`).join('\n')}

BUSINESS GOAL: ${businessPurpose.summary}

TECHNICAL CONTEXT: ${businessPurpose.technicalContext}

IMPLEMENTATION INSTRUCTIONS:
1. Implement the required functionality by modifying existing files or creating new ones
2. Study the existing codebase structure and follow established patterns
3. Make your changes fit naturally into the existing architecture

CODEBASE CONTEXT:
- All existing files, dependencies, and structure are available
- Follow the project's existing conventions and patterns
- Use the same libraries and frameworks already in use`;

    if (previousHints.length > 0) {
      prompt += `\n\nCRITICAL HINTS (incorporate these):
${previousHints.map((hint, idx) => `${idx + 1}. ${hint.content}`).join('\n')}`;
    }

    prompt += `\n\nSTART IMPLEMENTING NOW. Use the existing codebase as your foundation and implement the required functionality.`;

    return prompt;
  }

  private async executeClaudeCode(prompt: string, workDir: string): Promise<{
    code: string;
    success: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const messages: SDKMessage[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const abortController = new AbortController();
      
      // Set a timeout for the operation
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 300000); // 5 minutes

      logger.debug(`Executing Claude Code in directory: ${workDir}`);
      logger.debug(`Claude Code prompt: ${prompt}`);

      for await (const message of query({
        prompt,
        abortController,
        options: {
          maxTurns: 8, // Reduced from 10 to force more focused implementation
          cwd: workDir
        }
      })) {
        messages.push(message);
        
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
            logger.debug(`Claude Code: User input received (non-text content)`);
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
        // Extract generated code from the working directory
        logger.debug(`✅ Claude Code completed successfully, extracting generated files...`);
        const generatedCode = await this.extractGeneratedCode(workDir);
        logger.debug(`📁 Generated code (${generatedCode.length} chars): ${generatedCode}`);
        
        return {
          code: generatedCode,
          success: true,
          errors: [],
          warnings: []
        };
      } else {
        // Handle error cases
        return {
          code: '',
          success: false,
          errors: [`Claude Code failed: ${resultMessage.subtype}`],
          warnings: []
        };
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          code: '',
          success: false,
          errors: ['Claude Code execution timed out'],
          warnings: []
        };
      }
      
      logger.error(`Claude Code SDK error: ${error}`);
      return {
        code: '',
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: []
      };
    }
  }

  private async extractGeneratedCode(workDir: string): Promise<string> {
    const srcDir = path.join(workDir, 'src');
    const codeFiles: string[] = [];

    if (await fs.pathExists(srcDir)) {
      const files = await this.getAllFiles(srcDir);
      logger.debug(`📂 Found ${files.length} generated files in src/`);
      
      for (const file of files) {
        const relativePath = path.relative(workDir, file);
        const content = await fs.readFile(file, 'utf-8');
        logger.debug(`📄 Generated file: ${relativePath} (${content.length} chars)`);
        
        codeFiles.push(`// File: ${relativePath}`);
        codeFiles.push(content);
        codeFiles.push(''); // Empty line between files
      }
    }

    // Also check for files in the root directory
    const rootFiles = await this.getAllFiles(workDir);
    for (const file of rootFiles) {
      const fileName = path.basename(file);
      // Skip package.json and .gitignore that we created
      if (fileName !== 'package.json' && fileName !== '.gitignore' && this.isCodeFile(fileName)) {
        const content = await fs.readFile(file, 'utf-8');
        codeFiles.push(`// File: ${fileName}`);
        codeFiles.push(content);
        codeFiles.push('');
      }
    }

    if (codeFiles.length === 0) {
      throw new Error('No code files generated by Claude Code');
    }

    return codeFiles.join('\n');
  }

  private async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    if (!(await fs.pathExists(dir))) {
      return files;
    }

    const items = await fs.readdir(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);
      
      if (stat.isDirectory() && item !== 'node_modules' && item !== '.git') {
        const subFiles = await this.getAllFiles(fullPath);
        files.push(...subFiles);
      } else if (this.isCodeFile(item)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private isCodeFile(filename: string): boolean {
    const codeExtensions = [
      '.js', '.ts', '.jsx', '.tsx',
      '.py', '.java', '.cpp', '.c',
      '.cs', '.go', '.rs', '.php',
      '.rb', '.swift', '.kt', '.scala',
      '.html', '.css', '.scss', '.less',
      '.json', '.xml', '.yaml', '.yml',
      '.md', '.txt', '.sql'
    ];
    
    const ext = path.extname(filename).toLowerCase();
    return codeExtensions.includes(ext);
  }

  async cleanup(): Promise<void> {
    if (this.workingDir && await fs.pathExists(this.workingDir)) {
      try {
        await tempManager.cleanupDirectory(this.workingDir);
        logger.debug(`Cleaned up Claude Code working directory: ${this.workingDir}`);
      } catch (error) {
        logger.warn(`Failed to cleanup working directory: ${error}`);
      }
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
          maxTurns: 1
        }
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