module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: [
    '@typescript-eslint',
  ],
  extends: [
    'eslint:recommended',
  ],
  env: {
    node: true,
    es2020: true,
  },
  rules: {
    // TypeScript specific rules (simplified since we don't have the full plugin)
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    
    // General ESLint rules
    'no-console': 'warn',
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-template': 'error',
    
    // Import/export rules
    'no-duplicate-imports': 'error',
    
    // Code style
    'brace-style': ['error', '1tbs', { allowSingleLine: true }],
    'comma-dangle': ['error', 'always-multiline'],
    'quotes': ['error', 'single', { avoidEscape: true }],
    'semi': ['error', 'always'],
    
    // Error prevention
    'no-trailing-spaces': 'error',
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],
    'eol-last': 'error',
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '*.js', // Ignore JS files in root (like this config file)
    'vitest.config.ts', // Will be handled separately
  ],
};