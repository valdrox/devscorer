export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
  diff: string;
}

export interface GitMerge {
  branch: string;
  author: string;
  date: Date;
  commits: GitCommit[];
  diff: string;
  linesChanged: number;
  projectContext: string;
}

export interface BusinessPurpose {
  summary: string;
  requirements: string[];
  technicalContext: string;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface ClaudeCodeResult {
  code: string;
  success: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface FunctionalityComparison {
  isEquivalent: boolean;
  similarityScore: number;
  gaps: string[];
  differences: string[];
}

export interface Hint {
  content: string;
  level: number;
  type: 'general' | 'specific' | 'technical';
}

export interface ContributionScore {
  developer: string;
  date: Date;
  branch: string;
  description: string;
  score: number;
  hintsNeeded: number;
  details: {
    attempts: number;
    hints: Hint[];
    baseComplexity: number;
    aiDifficulty: number;
  };
}

export interface AnalysisReport {
  repositoryUrl: string;
  analysisDate: Date;
  daysCovered: number;
  totalContributions: number;
  developerScores: ContributionScore[];
  summary: {
    topPerformers: string[];
    averageScore: number;
    complexityDistribution: Record<string, number>;
  };
}

export interface Config {
  anthropicApiKey: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxConcurrentAnalysis: number;
  claudeModel: string;
  maxHintsPerAnalysis: number;
  similarityThreshold: number;
}