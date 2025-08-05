import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { ClaudeRunner } from '../src/core/claude-runner';
import { tempManager } from '../src/utils/temp-manager';
import { BusinessPurpose } from '../src/types/index';

// Load environment variables from .env file
dotenv.config();

describe('Claude Code File Modification Tests', () => {
  let tempDir: string;
  let claudeRunner: ClaudeRunner;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await tempManager.createTempDirectory('claude-test-');
    claudeRunner = new ClaudeRunner();

    // Initialize git repository for diff extraction
    const simpleGit = (await import('simple-git')).default;
    const git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
  });

  afterEach(async () => {
    // Cleanup after each test
    await claudeRunner.cleanup();
    await tempManager.cleanupDirectory(tempDir);
  });

  afterAll(async () => {
    // Final cleanup
    await tempManager.cleanupAll();
  });

  describe('Basic File Modification', () => {
    test('should modify existing file content', async () => {
      // Skip test if no API key is available
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('Skipping Claude Code test - ANTHROPIC_API_KEY not set');
        return;
      }

      console.log('🧪 Starting Claude Code file modification test');
      console.log(`📁 Working directory: ${tempDir}`);

      // Setup: Create test file
      const testFile = path.join(tempDir, 'helloworld.md');
      const originalContent = 'hello world';
      const expectedContent = 'hello modified world';

      await fs.writeFile(testFile, originalContent, 'utf-8');
      console.log(`📄 Created test file with content: "${originalContent}"`);

      // Verify setup
      const setupContent = await fs.readFile(testFile, 'utf-8');
      expect(setupContent).toBe(originalContent);

      // Create business purpose for the modification task
      const businessPurpose: BusinessPurpose = {
        summary: 'Change the content of helloworld.md file',
        requirements: [
          'Modify the content from "hello world" to "hello modified world"',
          'Keep the same filename and format',
        ],
        technicalContext: 'Simple text file modification task',
      };

      console.log('🤖 Running Claude Code with task...');

      // Action: Run Claude Code to modify the file
      const result = await claudeRunner.runClaudeCode(
        businessPurpose,
        'Test project with a single markdown file',
        tempDir,
        '', // No original diff since this is a test
        [] // No previous hints
      );

      // Debug output
      console.log('📊 Claude Code result:', {
        success: result.success,
        codeLength: result.code?.length || 0,
        errors: result.errors,
        warnings: result.warnings,
      });

      // Verification: Check if Claude Code succeeded
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      // Verification: Check if file was actually modified
      const modifiedContent = await fs.readFile(testFile, 'utf-8');
      console.log(`📄 Final file content: "${modifiedContent}"`);

      expect(modifiedContent.trim()).toBe(expectedContent);

      console.log('✅ Test completed successfully!');
    }, 90000); // 90 second timeout for Claude Code execution

    test('should create new file when requested', async () => {
      // Skip test if no API key is available
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('Skipping Claude Code test - ANTHROPIC_API_KEY not set');
        return;
      }

      const newFileName = 'newfile.txt';
      const newFilePath = path.join(tempDir, newFileName);
      const expectedContent = 'This is a new file created by Claude Code';

      console.log('🧪 Testing file creation...');

      // Verify file doesn't exist initially
      expect(await fs.pathExists(newFilePath)).toBe(false);

      // Create business purpose for the file creation task
      const businessPurpose: BusinessPurpose = {
        summary: 'Create a new text file',
        requirements: [`Create a file named "${newFileName}"`, `Write the content: "${expectedContent}"`],
        technicalContext: 'File creation task in temporary directory',
      };

      // Action: Run Claude Code to create the file
      const result = await claudeRunner.runClaudeCode(
        businessPurpose,
        'Test project for file creation',
        tempDir,
        '', // No original diff
        [] // No previous hints
      );

      // Debug output
      console.log('📊 Claude Code file creation result:', {
        success: result.success,
        codeLength: result.code?.length || 0,
        errors: result.errors,
      });

      // Verification: Check if Claude Code succeeded
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      // Verification: Check if file was created with correct content
      expect(await fs.pathExists(newFilePath)).toBe(true);
      const createdContent = await fs.readFile(newFilePath, 'utf-8');
      expect(createdContent.trim()).toBe(expectedContent);

      console.log('✅ File creation test completed successfully!');
    }, 60000); // 60 second timeout

    test('should work in the correct temporary directory', async () => {
      // Skip test if no API key is available
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('Skipping Claude Code test - ANTHROPIC_API_KEY not set');
        return;
      }

      console.log('🧪 Testing working directory verification...');

      // Create a unique marker file in our temp directory
      const markerFile = path.join(tempDir, 'marker.txt');
      const markerContent = `unique-marker-${Date.now()}`;
      await fs.writeFile(markerFile, markerContent, 'utf-8');

      console.log(`📄 Created marker file with content: "${markerContent}"`);

      const businessPurpose: BusinessPurpose = {
        summary: 'Verify working directory by reading marker file',
        requirements: [
          'Read the marker.txt file',
          'Create a response.txt file with the content you read from marker.txt',
          'This will prove you are working in the correct directory',
        ],
        technicalContext: 'Directory verification test',
      };

      const result = await claudeRunner.runClaudeCode(
        businessPurpose,
        'Directory verification test project',
        tempDir,
        '',
        []
      );

      // Debug output
      console.log('📊 Directory verification result:', {
        success: result.success,
        errors: result.errors,
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      // Check if response file was created with correct content
      const responsePath = path.join(tempDir, 'response.txt');
      expect(await fs.pathExists(responsePath)).toBe(true);

      const responseContent = await fs.readFile(responsePath, 'utf-8');
      expect(responseContent.trim()).toBe(markerContent);

      console.log('✅ Directory verification test completed successfully!');
    }, 60000);
  });
});
