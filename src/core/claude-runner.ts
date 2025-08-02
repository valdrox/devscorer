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
    previousHints: Hint[] = []
  ): Promise<ClaudeCodeResult> {
    logger.info('Running Claude Code with business requirements');

    try {
      const workDir = await this.createWorkingDirectory();
      const prompt = this.buildPrompt(businessPurpose, projectContext, previousHints);
      
      const result = await this.executeClaudeCode(prompt, workDir);
      
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

  private async createWorkingDirectory(): Promise<string> {
    this.workingDir = await tempManager.createTempDirectory('claude-work-');
    
    const srcDir = path.join(this.workingDir, 'src');
    await fs.ensureDir(srcDir);
    
    await this.createBasicProjectStructure(this.workingDir);
    
    logger.debug(`Created working directory: ${this.workingDir}`);
    return this.workingDir;
  }

  private async createBasicProjectStructure(workDir: string): Promise<void> {
    const packageJson = {
      name: 'claude-test-project',
      version: '1.0.0',
      description: 'Test project for Claude Code analysis',
      main: 'src/index.js',
      scripts: {
        test: 'echo "No tests specified"',
        build: 'echo "No build specified"'
      }
    };

    await fs.writeJson(path.join(workDir, 'package.json'), packageJson, { spaces: 2 });
    
    const gitignore = `node_modules/\n*.log\ndist/\nbuild/\n.env\n`;
    await fs.writeFile(path.join(workDir, '.gitignore'), gitignore);
  }

  private buildPrompt(
    businessPurpose: BusinessPurpose,
    projectContext: string,
    previousHints: Hint[]
  ): string {
    let prompt = `You are implementing a feature based on these requirements:

BUSINESS GOAL:
${businessPurpose.summary}

SPECIFIC REQUIREMENTS:
${businessPurpose.requirements.map((req, idx) => `${idx + 1}. ${req}`).join('\n')}

TECHNICAL CONTEXT:
${businessPurpose.technicalContext}

PROJECT CONTEXT:
${projectContext}

COMPLEXITY LEVEL: ${businessPurpose.complexity}

Please implement code that fulfills these requirements. Focus on creating functional, working code that addresses all the specified requirements.`;

    if (previousHints.length > 0) {
      prompt += `\n\nIMPORTANT HINTS FROM PREVIOUS ATTEMPTS:
${previousHints.map((hint, idx) => `${idx + 1}. ${hint.content}`).join('\n')}

Please incorporate these hints into your implementation.`;
    }

    prompt += `\n\nCreate the necessary files in the src/ directory. Make sure your implementation is complete and functional.`;

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

      for await (const message of query({
        prompt,
        abortController,
        options: {
          maxTurns: 10,
          cwd: workDir
        }
      })) {
        messages.push(message);
        
        // Log progress for debugging
        if (message.type === 'assistant') {
          logger.debug('Claude Code: Assistant message received');
        } else if (message.type === 'result') {
          logger.debug(`Claude Code completed with ${message.num_turns} turns`);
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
        const generatedCode = await this.extractGeneratedCode(workDir);
        
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
      
      for (const file of files) {
        const relativePath = path.relative(workDir, file);
        const content = await fs.readFile(file, 'utf-8');
        
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