import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 90000, // 90 seconds for Claude Code tests
  },
});