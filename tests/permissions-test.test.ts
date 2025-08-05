import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { tempManager } from '../src/utils/temp-manager';

describe('Directory Permissions Test', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await tempManager.createTempDirectory('permissions-test-');
  });

  afterEach(async () => {
    await tempManager.cleanupDirectory(tempDir);
  });

  test('should verify Node.js can write to the same temp directory Claude Code uses', async () => {
    console.log(`🧪 Testing Node.js permissions in temp directory: ${tempDir}`);

    // Test 1: Check directory exists and is accessible
    const dirExists = await fs.pathExists(tempDir);
    expect(dirExists).toBe(true);
    console.log(`📁 Directory exists: ${dirExists}`);

    // Test 2: Check directory permissions
    const dirStats = await fs.stat(tempDir);
    console.log(`📊 Directory permissions: ${(dirStats.mode & parseInt('777', 8)).toString(8)}`);
    console.log(`📊 Directory owner: uid=${dirStats.uid}, gid=${dirStats.gid}`);
    console.log(`📊 Current process: uid=${process.getuid()}, gid=${process.getgid()}`);

    // Test 3: Create a file with Node.js
    const testFile = path.join(tempDir, 'node-test.txt');
    const testContent = 'Node.js can write this content';

    await fs.writeFile(testFile, testContent, 'utf-8');
    console.log('✅ Node.js successfully created file');

    // Test 4: Verify file was created and readable
    const fileExists = await fs.pathExists(testFile);
    expect(fileExists).toBe(true);

    const readContent = await fs.readFile(testFile, 'utf-8');
    expect(readContent).toBe(testContent);
    console.log(`📄 Node.js successfully read file: "${readContent}"`);

    // Test 5: Modify the file
    const modifiedContent = 'Node.js modified this content';
    await fs.writeFile(testFile, modifiedContent, 'utf-8');

    const newContent = await fs.readFile(testFile, 'utf-8');
    expect(newContent).toBe(modifiedContent);
    console.log(`📝 Node.js successfully modified file: "${newContent}"`);

    // Test 6: Check file permissions
    const fileStats = await fs.stat(testFile);
    console.log(`📊 File permissions: ${(fileStats.mode & parseInt('777', 8)).toString(8)}`);
    console.log(`📊 File owner: uid=${fileStats.uid}, gid=${fileStats.gid}`);

    // Test 7: Create multiple files to test directory writability
    const files = ['file1.txt', 'file2.txt', 'file3.txt'];
    for (const fileName of files) {
      const filePath = path.join(tempDir, fileName);
      await fs.writeFile(filePath, `Content of ${fileName}`, 'utf-8');
    }
    console.log('✅ Node.js successfully created multiple files');

    // Test 8: List directory contents
    const dirContents = await fs.readdir(tempDir);
    console.log(`📁 Directory contents: ${dirContents.join(', ')}`);
    expect(dirContents).toHaveLength(4); // node-test.txt + 3 additional files

    // Test 9: Test subdirectory creation
    const subDir = path.join(tempDir, 'subdir');
    await fs.ensureDir(subDir);
    const subDirFile = path.join(subDir, 'subfile.txt');
    await fs.writeFile(subDirFile, 'Content in subdirectory', 'utf-8');
    console.log('✅ Node.js successfully created subdirectory and file');

    // Test 10: Verify everything is readable
    const subContent = await fs.readFile(subDirFile, 'utf-8');
    expect(subContent).toBe('Content in subdirectory');

    console.log('✅ All Node.js permission tests passed - directory is fully writable');
  });

  test('should test the exact same directory structure as Claude Code test', async () => {
    console.log('🧪 Replicating exact Claude Code test scenario...');

    // Create the exact same file that Claude Code test uses
    const testFile = path.join(tempDir, 'test.txt');
    const originalContent = 'original content';

    await fs.writeFile(testFile, originalContent, 'utf-8');
    console.log(`📄 Created test.txt with: "${originalContent}"`);

    // Verify we can read it
    const readContent = await fs.readFile(testFile, 'utf-8');
    expect(readContent).toBe(originalContent);
    console.log(`📖 Node.js can read: "${readContent}"`);

    // Modify it exactly like Claude Code should
    const modifiedContent = 'modified content';
    await fs.writeFile(testFile, modifiedContent, 'utf-8');
    console.log(`📝 Node.js modified to: "${modifiedContent}"`);

    // Verify the modification
    const finalContent = await fs.readFile(testFile, 'utf-8');
    expect(finalContent).toBe(modifiedContent);
    console.log(`✅ Final content: "${finalContent}"`);

    console.log('✅ Node.js can perform exact same operation that Claude Code should do');
  });
});
