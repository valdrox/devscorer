// Developer-centric analysis types

export interface DeveloperDiscovery {
  username: string;
  totalRepositories: number;
  totalCommits: number;
  totalIssues: number;
  totalPullRequests: number;
  totalReviews: number;
  totalComments: number;
  repositories: RepositoryActivity[];
  organizations: string[];
  estimatedLLMCalls: number;
}

export interface RepositoryActivity {
  fullName: string; // "owner/repo"
  owner: string;
  name: string;
  commits: number;
  issues: number;
  pullRequests: number;
  reviews: number;
  comments: number;
  isPrivate: boolean;
  primaryLanguage?: string;
  lastActivityDate: string;
}

export interface DeveloperScope {
  username: string;
  organizations?: string[];
  repositories?: string[];
  orgRepositories?: string; // analyze only repos owned by this org
  days: number;
  activityTypes?: ActivityType[];
}

export type ActivityType = 'commits' | 'issues' | 'pullRequests' | 'reviews' | 'comments';

export interface DeveloperAnalysis {
  username: string;
  scope: DeveloperScope;
  discovery: DeveloperDiscovery;
  technicalAnalysis?: any; // From existing git analyzer
  socialAnalysis?: any; // From existing GitHub analyzer
  combinedScore: DeveloperScore;
  analysisDate: Date;
  processingTime: number;
}

export interface DeveloperScore {
  technical: {
    codeComplexity: number;
    implementationQuality: number;
    problemSolving: number;
    overall: number;
  };
  social: {
    communication: number;
    collaboration: number;
    leadership: number;
    delivery: number;
    overall: number;
  };
  combined: {
    score: number;
    confidence: number; // How much data we had to work with
    breakdown: {
      technicalWeight: number;
      socialWeight: number;
    };
  };
}

export interface DiscoveryFilters {
  organizations?: string[];
  repositories?: string[];
  orgRepositories?: string;
  minActivity?: number; // minimum activities to include a repo
  excludeForked?: boolean;
  excludePrivate?: boolean;
}

export interface ConfirmationPrompt {
  discovery: DeveloperDiscovery;
  estimatedCost: number;
  estimatedDuration: number;
  message: string;
}