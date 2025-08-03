import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { tempManager } from '../src/utils/temp-manager';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';

// Load environment variables from .env file
dotenv.config();

describe('Claude Code Directory Test', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await tempManager.createTempDirectory('claude-dir-test-');
  });

  afterEach(async () => {
    await tempManager.cleanupDirectory(tempDir);
  });

  test('should check what directory Claude Code actually sees', async () => {
    // Skip test if no API key is available
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping Claude Code test - ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('🧪 Testing what directory Claude Code actually sees');
    console.log(`📁 Expected directory: ${tempDir}`);

    // Create marker files that Claude Code should be able to see
    await fs.writeFile(path.join(tempDir, 'marker1.txt'), 'I am marker 1', 'utf-8');
    await fs.writeFile(path.join(tempDir, 'marker2.txt'), 'I am marker 2', 'utf-8');
    await fs.writeFile(path.join(tempDir, 'test-data.json'), JSON.stringify({
      message: "Claude Code should see this",
      timestamp: new Date().toISOString(),
      directory: tempDir
    }, null, 2), 'utf-8');

    console.log('📄 Created marker files that Claude Code should see');

    // Simple prompt to check directory and try to write
    const prompt = `Please help me understand what directory you're working in and test file operations.

TASKS:
1. Run 'pwd' to show your current working directory
2. Run 'ls -la' to list all files in the current directory (you should see marker1.txt, marker2.txt, and test-data.json)
3. Read the content of marker1.txt and marker2.txt
4. Create a new file called 'claude-response.txt' with the following content:
   "Claude Code was here at [current timestamp]
   Working directory: [the pwd result]
   Files I can see: [list the files you found]"
5. Try to modify marker1.txt to say "Claude Code modified this file"
6. Confirm all operations by reading back the files

Please complete these tasks and report what you find.`;

    console.log('🤖 Asking Claude Code to investigate directory and file operations...');

    let claudeOutput: string[] = [];
    let success = false;
    
    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 45000); // 45 second timeout

      for await (const message of query({
        prompt,
        abortController,
        options: {
          maxTurns: 15,
          cwd: tempDir
        }
      })) {
        if (message.type === 'result') {
          console.log(`📊 Claude Code result: ${message.subtype} (${message.num_turns} turns)`);
          success = message.subtype === 'success';
        } else if (message.type === 'assistant') {
          const content = message.message.content;
          if (Array.isArray(content) && content.length > 0) {
            const textContent = content.find(c => c.type === 'text');
            if (textContent && 'text' in textContent) {
              claudeOutput.push(textContent.text);
              console.log(`🤖 Claude: ${textContent.text.substring(0, 150)}...`);
            }
          }
        }
      }

      clearTimeout(timeoutId);

    } catch (error) {
      console.error(`❌ Claude Code error: ${error}`);
      success = false;
    }

    console.log(`📊 Claude Code success: ${success}`);
    console.log(`📝 Claude Code output length: ${claudeOutput.join('').length} characters`);

    // Check what files exist after Claude Code ran
    const finalFiles = await fs.readdir(tempDir);
    console.log(`📁 Files after Claude Code: ${finalFiles.join(', ')}`);

    // Check if Claude Code created the response file
    const responseFile = path.join(tempDir, 'claude-response.txt');
    const responseExists = await fs.pathExists(responseFile);
    console.log(`📄 Claude response file exists: ${responseExists}`);

    if (responseExists) {
      const responseContent = await fs.readFile(responseFile, 'utf-8');
      console.log(`📄 Claude response content: "${responseContent}"`);
    }

    // Check if Claude Code modified marker1.txt
    const marker1Content = await fs.readFile(path.join(tempDir, 'marker1.txt'), 'utf-8');
    console.log(`📄 marker1.txt final content: "${marker1Content}"`);

    // Check marker2.txt
    const marker2Content = await fs.readFile(path.join(tempDir, 'marker2.txt'), 'utf-8');
    console.log(`📄 marker2.txt final content: "${marker2Content}"`);

    // Report findings
    console.log('\n🔍 ANALYSIS:');
    console.log(`- Claude Code success: ${success}`);
    console.log(`- Response file created: ${responseExists}`);
    console.log(`- marker1.txt modified: ${marker1Content !== 'I am marker 1'}`);
    console.log(`- Total files found: ${finalFiles.length}`);

    // This test is for investigation, so we don't fail on assertions
    // Just report what we found
    expect(success).toBe(true); // Claude should at least complete successfully

  }, 60000); // 60 second timeout
});