import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { tempManager } from '../src/utils/temp-manager';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';

// Load environment variables from .env file
dotenv.config();

describe('Simple Claude Code File Test', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await tempManager.createTempDirectory('simple-test-');
  });

  afterEach(async () => {
    await tempManager.cleanupDirectory(tempDir);
  });

  test('should be able to modify a simple file', async () => {
    // Skip test if no API key is available
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping Claude Code test - ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('🧪 Running simple Claude Code file modification test');
    console.log(`📁 Temp directory: ${tempDir}`);

    // Setup: Create test file
    const testFile = path.join(tempDir, 'test.txt');
    await fs.writeFile(testFile, 'original content', 'utf-8');

    console.log('📄 Created test file with "original content"');

    // Simple prompt for Claude Code
    const prompt = `Please change the content of the file "test.txt" from "original content" to "modified content".

Steps:
1. Read the current content of test.txt
2. Change it to "modified content"  
3. Save the file
4. Confirm the change

Complete this task now.`;

    console.log('🤖 Sending task to Claude Code...');

    // Run Claude Code directly with the SDK
    let success = false;

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 30000); // 30 second timeout

      for await (const message of query({
        prompt,
        abortController,
        options: {
          maxTurns: 8,
          cwd: tempDir,
          permissionMode: 'bypassPermissions',
        },
      })) {
        if (message.type === 'result') {
          console.log(`📊 Result: ${message.subtype} (${message.num_turns} turns)`);
          success = message.subtype === 'success';
        } else if (message.type === 'assistant') {
          const content = message.message.content;
          if (Array.isArray(content) && content.length > 0) {
            const textContent = content.find(c => c.type === 'text');
            if (textContent && 'text' in textContent) {
              console.log(`🤖 Claude: ${textContent.text.substring(0, 100)}...`);
            }
          }
        }
      }

      clearTimeout(timeoutId);
    } catch (error) {
      console.error(`❌ Claude Code error: ${error}`);
      success = false;
    }

    // Check results
    console.log(`📊 Claude Code success: ${success}`);

    const finalContent = await fs.readFile(testFile, 'utf-8');
    console.log(`📄 Final file content: "${finalContent}"`);

    // Assertions
    expect(success).toBe(true);
    expect(finalContent.trim()).toBe('modified content');

    console.log('✅ Simple test completed!');
  }, 45000); // 45 second timeout
});
