export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
  diff: string;
}

export interface GitContribution {
  branch: string;
  author: string;
  date: Date;
  commits: GitCommit[];
  diff: string;
  linesChanged: number;
  projectContext: string;
  commitHash: string;
  preCommitHash: string;
}

export interface BusinessPurpose {
  summary: string;
  requirements: string[];
  technicalContext: string;
}

export interface ClaudeCodeResult {
  code: string;
  success: boolean;
  errors?: string[];
  warnings?: string[];
}


export interface TechnicalComparison {
  factorsThatMakeABetter: string[];
  factorsThatMakeBBetter: string[];
  isEquivalent: boolean;
  superiorContribution: 'A' | 'B' | 'NEITHER';
  similarityScore: number;
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

// GitHub-specific types
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  state: 'open' | 'closed';
  user: {
    login: string;
  };
  comments: number;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  state: 'open' | 'closed' | 'merged';
  user: {
    login: string;
  };
  comments: number;
  review_comments: number;
}

export interface GitHubReview {
  id: number;
  body: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  submitted_at: string;
  user: {
    login: string;
  };
  pull_request: {
    title: string;
    number: number;
  };
}

export interface GitHubComment {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
  };
  issue_url?: string;
  pull_request_url?: string;
}

export interface DeveloperActivity {
  developer: string;
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
  reviews: GitHubReview[];
  comments: GitHubComment[];
}

export interface GitHubAnalysis {
  developer: string;
  technicalQuality: number;
  communication: number;
  collaboration: number;
  delivery: number;
  overallScore: number;
  examples: string[];
  suggestions: string[];
}

export interface GitHubReport {
  repositoryUrl: string;
  analysisDate: Date;
  daysCovered: number;
  developerAnalyses: GitHubAnalysis[];
  summary: {
    topPerformers: string[];
    averageScore: number;
    teamInsights: string[];
  };
}
