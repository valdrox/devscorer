import fs from 'fs-extra';
import path from 'path';
import tmp from 'tmp';
import { logger } from './logger.js';
import { config } from './config.js';

export class TempManager {
  private tempDirs: Set<string> = new Set();
  private cleanupHandlers: Set<() => void> = new Set();

  constructor() {
    this.setupCleanupHandlers();
  }

  async createTempDirectory(prefix: string = 'devscorer-'): Promise<string> {
    const options: tmp.DirOptions = {
      prefix,
      unsafeCleanup: true
    };

    // Let Node.js use the system temp directory (no custom override)
    const tempDir = tmp.dirSync(options);
    this.tempDirs.add(tempDir.name);
    
    const cleanup = () => {
      try {
        tempDir.removeCallback();
        this.tempDirs.delete(tempDir.name);
      } catch (error) {
        logger.warn(`Failed to cleanup temp directory ${tempDir.name}: ${error}`);
      }
    };

    this.cleanupHandlers.add(cleanup);
    
    logger.debug(`Created temp directory: ${tempDir.name}`);
    return tempDir.name;
  }

  async createTempFile(
    suffix: string = '.tmp',
    prefix: string = 'devscorer-'
  ): Promise<{ path: string; cleanup: () => void }> {
    const options: tmp.FileOptions = {
      prefix,
      postfix: suffix,
      discardDescriptor: true
    };

    // Let Node.js use the system temp directory (no custom override)
    const tempFile = tmp.fileSync(options);
    
    const cleanup = () => {
      try {
        tempFile.removeCallback();
      } catch (error) {
        logger.warn(`Failed to cleanup temp file ${tempFile.name}: ${error}`);
      }
    };

    this.cleanupHandlers.add(cleanup);
    
    logger.debug(`Created temp file: ${tempFile.name}`);
    return {
      path: tempFile.name,
      cleanup
    };
  }

  async copyToTemp(sourcePath: string, prefix: string = 'copy-'): Promise<string> {
    if (!(await fs.pathExists(sourcePath))) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const sourceStats = await fs.stat(sourcePath);
    
    if (sourceStats.isDirectory()) {
      const tempDir = await this.createTempDirectory(prefix);
      await fs.copy(sourcePath, tempDir);
      return tempDir;
    } else {
      const ext = path.extname(sourcePath);
      const { path: tempPath } = await this.createTempFile(ext, prefix);
      await fs.copy(sourcePath, tempPath);
      return tempPath;
    }
  }

  async writeToTemp(
    content: string,
    suffix: string = '.txt',
    prefix: string = 'content-'
  ): Promise<string> {
    const { path: tempPath } = await this.createTempFile(suffix, prefix);
    await fs.writeFile(tempPath, content, 'utf-8');
    return tempPath;
  }

  async cleanupDirectory(dirPath: string): Promise<void> {
    if (!this.tempDirs.has(dirPath)) {
      logger.warn(`Attempted to cleanup non-temp directory: ${dirPath}`);
      return;
    }

    try {
      if (await fs.pathExists(dirPath)) {
        await fs.remove(dirPath);
        logger.debug(`Cleaned up temp directory: ${dirPath}`);
      }
      this.tempDirs.delete(dirPath);
    } catch (error) {
      logger.warn(`Failed to cleanup temp directory ${dirPath}: ${error}`);
    }
  }

  async cleanupAll(): Promise<void> {
    logger.info('Cleaning up all temporary files and directories');
    
    const cleanupPromises = Array.from(this.cleanupHandlers).map(cleanup => {
      return new Promise<void>((resolve) => {
        try {
          cleanup();
        } catch (error) {
          logger.warn(`Cleanup handler failed: ${error}`);
        }
        resolve();
      });
    });

    await Promise.all(cleanupPromises);
    
    this.tempDirs.clear();
    this.cleanupHandlers.clear();
    
    logger.info('Temporary cleanup completed');
  }

  getTempDirectories(): string[] {
    return Array.from(this.tempDirs);
  }

  private setupCleanupHandlers(): void {
    const cleanupAndExit = () => {
      this.cleanupAll().finally(() => {
        process.exit(0);
      });
    };

    process.on('SIGINT', cleanupAndExit);
    process.on('SIGTERM', cleanupAndExit);
    process.on('exit', () => {
      this.cleanupHandlers.forEach(cleanup => {
        try {
          cleanup();
        } catch (error) {
          // Ignore errors during exit cleanup
        }
      });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      this.cleanupAll().finally(() => {
        process.exit(1);
      });
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      this.cleanupAll().finally(() => {
        process.exit(1);
      });
    });
  }
}

export const tempManager = new TempManager();