import { logger } from './logger.js';
import { type SDKMessage } from '@anthropic-ai/claude-code';
import chalk from 'chalk';

interface ClaudeCodeContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: any;
  is_error?: boolean;
  content?: string;
}

interface ClaudeCodeMessage {
  content: ClaudeCodeContentBlock[] | string;
}

export class ClaudeCodeMessageLogger {
  /**
   * Log a Claude Code SDK message with detailed breakdown of all content blocks
   */
  logMessage(message: SDKMessage): void {
    if (message.type === 'assistant') {
      this.logAssistantMessage(message.message);
    } else if (message.type === 'user') {
      this.logUserMessage(message.message);
    } else if (message.type === 'result') {
      logger.debug(`Claude Code completed with ${message.num_turns} turns, result: ${message.subtype}`);
    } else if (message.type === 'system') {
      logger.debug(`Claude Code: System message - ${message.subtype}`);
    }
  }

  private logAssistantMessage(message: ClaudeCodeMessage): void {
    const content = message.content;
    if (Array.isArray(content) && content.length > 0) {
      for (let i = 0; i < content.length; i++) {
        const block = content[i];
        this.logContentBlock(block);
      }
    }
  }

  private logUserMessage(message: ClaudeCodeMessage): void {
    const content = message.content;
    if (Array.isArray(content) && content.length > 0) {
      for (let i = 0; i < content.length; i++) {
        const block = content[i];
        this.logUserContentBlock(block);
      }
    } else if (typeof content === 'string') {
      logger.debug(`Claude Code User: ${content}`);
    } else {
      logger.debug('Claude Code: User input received (non-text content)');
    }
  }

  private logContentBlock(block: ClaudeCodeContentBlock): void {
    if (block.type === 'text') {
      logger.debug(`Claude Code [TEXT]: ${block.text}`);
    } else if (block.type === 'tool_use') {
      this.logToolUse(block);
    } else if (block.type === 'tool_result') {
      logger.debug(`Claude Code [RESULT]: ${block.is_error ? 'ERROR' : 'SUCCESS'} - ${block.content}`);
    } else {
      logger.debug(`Claude Code [${block.type}]: ${JSON.stringify(block, null, 2)}`);
    }
  }

  private logUserContentBlock(block: ClaudeCodeContentBlock): void {
    if (block.type === 'text') {
      logger.debug(`Claude Code User [TEXT]: ${block.text}`);
    } else if (block.type === 'tool_result') {
      logger.debug(`Claude Code User [TOOL_RESULT]: ${block.is_error ? 'ERROR' : 'SUCCESS'} - ${block.content}`);
    } else {
      logger.debug(`Claude Code User [${block.type}]: ${JSON.stringify(block, null, 2)}`);
    }
  }

  private logToolUse(block: ClaudeCodeContentBlock): void {
    const toolName = block.name;
    const input = block.input;

    switch (toolName) {
      case 'Edit':
        this.logEditTool(input);
        break;
      case 'MultiEdit':
        this.logMultiEditTool(input);
        break;
      case 'Write':
        this.logWriteTool(input);
        break;
      case 'Read':
        this.logReadTool(input);
        break;
      case 'TodoWrite':
        this.logTodoWriteTool(input);
        break;
      case 'LS':
        this.logLSTool(input);
        break;
      case 'Task':
        this.logTaskTool(input);
        break;
      case 'Grep':
        this.logGrepTool(input);
        break;
      default:
        logger.debug(`Claude Code [${toolName}]: ${JSON.stringify(input, null, 2)}`);
    }
  }

  private logEditTool(input: any): void {
    logger.debug(`Claude Code [Edit]: ${input.file_path}`);
    logger.debug(`  Old: ${JSON.stringify(input.old_string)}`);
    logger.debug(`  New: ${JSON.stringify(input.new_string)}`);
    if (input.replace_all) {
      logger.debug(`  Replace All: true`);
    }
  }

  private logMultiEditTool(input: any): void {
    logger.debug(`Claude Code [MultiEdit]: ${input.file_path} (${input.edits.length} edits)`);
    input.edits.forEach((edit: any, index: number) => {
      logger.debug(`  Edit ${index + 1}:`);
      logger.debug(`    Old: ${JSON.stringify(edit.old_string)}`);
      logger.debug(`    New: ${JSON.stringify(edit.new_string)}`);
      if (edit.replace_all) {
        logger.debug(`    Replace All: true`);
      }
    });
  }

  private logWriteTool(input: any): void {
    logger.debug(`Claude Code [Write]: ${input.file_path}`);
    logger.debug(`  Content (${input.content.length} chars): ${input.content.substring(0, 200)}${input.content.length > 200 ? '...' : ''}`);
  }

  private logReadTool(input: any): void {
    logger.debug(`Claude Code [Read]: ${input.file_path}`);
  }

  private logTodoWriteTool(input: any): void {
    logger.debug(`Claude Code [TodoWrite]: ${input.todos ? input.todos.length : 0} todos`);
    if (input.todos && Array.isArray(input.todos)) {
      input.todos.forEach((todo: any, index: number) => {
        logger.debug(`  Todo ${index + 1}: [${todo.status}] ${todo.content}`);
      });
    }
  }

  private logLSTool(input: any): void {
    logger.debug(`Claude Code [LS]: ${input.path}`);
  }

  private logTaskTool(input: any): void {
    logger.debug(`Claude Code [Task]: ${input.subagent_type}`);
    logger.debug(`  Description: ${input.description}`);
    logger.debug(`  Prompt: ${input.prompt}`);
  }

  private logGrepTool(input: any): void {
    logger.debug(`Claude Code [Grep]: pattern="${input.pattern}"`);
    if (input.path) logger.debug(`  Path: ${input.path}`);
    if (input.type) logger.debug(`  Type: ${input.type}`);
    if (input.output_mode) logger.debug(`  Output mode: ${input.output_mode}`);
    if (input.glob) logger.debug(`  Glob: ${input.glob}`);
    if (input['-i']) logger.debug(`  Case insensitive: true`);
    if (input['-n']) logger.debug(`  Show line numbers: true`);
    if (input['-A']) logger.debug(`  After context: ${input['-A']}`);
    if (input['-B']) logger.debug(`  Before context: ${input['-B']}`);
    if (input['-C']) logger.debug(`  Context: ${input['-C']}`);
  }
}

// Export singleton instance for convenience
export const claudeCodeLogger = new ClaudeCodeMessageLogger();