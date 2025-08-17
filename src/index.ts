#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs-extra';
import { AnalysisReport } from './types/index.js';
import { logger } from './utils/logger.js';

// Import command functions
import { evaluateCommand } from './commands/evaluate.js';
import { reviewCommand } from './commands/review.js';
import { githubAnalysisCommand } from './commands/github.js';
import { checkCommand, loginCommand, logoutCommand, authStatusCommand } from './commands/auth.js';


async function main() {
  const program = new Command();

  program
    .name('devscorer')
    .description('Dev performance evaluator')
    .version('1.0.0');

  // Evaluate command
  program
    .command('evaluate')
    .description('Comprehensive developer evaluation (combines code + social analysis)')
    .argument('<username>', 'GitHub username to evaluate')
    .option('-d, --days <number>', 'Number of days to analyze', '30')
    .option('--org <organization>', 'Limit analysis to specific organization')
    .option('--repos <repositories>', 'Limit analysis to specific repositories (comma-separated)')
    .option('--org-repos <organization>', 'Analyze only repos owned by this organization')
    .option('--min-activity <number>', 'Minimum activities required to include a repository', '1')
    .option('-o, --output <file>', 'Output file for results (JSON format)')
    .option('--format <type>', 'Output format (table|json)', 'table')
    .option('--parallel', 'Enable parallel analysis for faster performance')
    .option('--concurrency <number>', 'Number of parallel operations to run', '5')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .action(evaluateCommand);

  // Review command
  program
    .command('review')
    .description('Analyze git contributions complexity using AI')
    .argument('<repo-url>', 'GitHub repository URL')
    .option('-d, --days <number>', 'Number of days to analyze', '7')
    .option('-l, --limit <number>', 'Maximum number of commits to analyze (for faster testing)')
    .option('-c, --commit <hash>', 'Analyze a specific commit by hash')
    .option('-o, --output <file>', 'Output file for results (JSON format)')
    .option('--format <type>', 'Output format (table|json|csv)', 'table')
    .option('--parallel', 'Enable parallel analysis for faster performance')
    .option('--concurrency <number>', 'Number of parallel operations to run', '5')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .action(reviewCommand);

  // Check command
  program
    .command('check')
    .description('Check if Claude Code is available and configured correctly')
    .action(checkCommand);

  // Login command
  program
    .command('login')
    .description('Store API keys securely (Anthropic API key + GitHub token)')
    .action(loginCommand);

  // Logout command
  program
    .command('logout')
    .description('Remove stored API keys from system keychain')
    .action(logoutCommand);

  // Auth status command
  program
    .command('auth-status')
    .description('Show authentication status')
    .action(authStatusCommand);

  // GitHub analysis command
  program
    .command('github-analysis')
    .description('Analyze developer performance through GitHub issues, PRs, and reviews')
    .argument('<repo-url>', 'GitHub repository URL')
    .option('-d, --days <number>', 'Number of days to analyze', '7')
    .option('-o, --output <file>', 'Output file for results (JSON format)')
    .option('--format <type>', 'Output format (table|json|csv)', 'table')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .action(githubAnalysisCommand);

  program.parse();
}

// Formatting functions (keep these in index.ts for export)
export function formatAsCSV(report: AnalysisReport): string {
  const lines: string[] = [];
  lines.push('Developer,Date,Branch,Description,Score,Hints Needed,Attempts,Base Complexity');

  for (const score of report.developerScores) {
    const line = [
      score.developer,
      score.date.toISOString().split('T')[0],
      `"${score.branch}"`,
      `"${score.description}"`,
      score.score.toString(),
      score.hintsNeeded.toString(),
      score.details.attempts.toString(),
      score.details.baseComplexity.toString(),
    ].join(',');
    lines.push(line);
  }

  return lines.join('\n');
}

export function formatGitHubReport(report: any): string {
  const lines: string[] = [];

  lines.push('================================================================================');
  lines.push('GITHUB ISSUES & PR ANALYSIS REPORT');
  lines.push('================================================================================');
  lines.push(`Repository: ${report.repositoryUrl}`);
  lines.push(`Analysis Date: ${report.analysisDate.toISOString().split('T')[0]}`);
  lines.push(`Period: Last ${report.daysCovered} days`);
  lines.push(`Developers Analyzed: ${report.developerAnalyses.length}`);
  lines.push(`Average Score: ${report.summary.averageScore}/10`);
  lines.push('');

  if (report.summary.topPerformers.length > 0) {
    lines.push('TOP PERFORMERS:');
    lines.push('----------------------------------------');
    report.summary.topPerformers.forEach((performer: string, index: number) => {
      lines.push(`${index + 1}. ${performer}`);
    });
    lines.push('');
  }

  lines.push('TEAM INSIGHTS:');
  lines.push('----------------------------------------');
  report.summary.teamInsights.forEach((insight: string) => {
    lines.push(`• ${insight}`);
  });
  lines.push('');

  if (report.developerAnalyses.length > 0) {
    lines.push('DETAILED DEVELOPER ANALYSIS:');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('Score | Developer        | Tech | Comm | Collab | Delivery | Example');
    lines.push('--------------------------------------------------------------------------------');

    for (const analysis of report.developerAnalyses) {
      const score = analysis.overallScore.toFixed(1);
      const tech = analysis.technicalQuality.toFixed(1);
      const comm = analysis.communication.toFixed(1);
      const collab = analysis.collaboration.toFixed(1);
      const delivery = analysis.delivery.toFixed(1);
      const example = analysis.examples[0] ? analysis.examples[0].substring(0, 40) + '...' : 'No examples';

      lines.push(
        `${score.padStart(5)} | ${analysis.developer.padEnd(16)} | ${tech.padStart(4)} | ${comm.padStart(4)} | ${collab.padStart(6)} | ${delivery.padStart(8)} | ${example}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatGitHubAsCSV(report: any): string {
  const lines: string[] = [];
  lines.push(
    'Developer,Overall Score,Technical Quality,Communication,Collaboration,Delivery,Top Example,Top Suggestion'
  );

  for (const analysis of report.developerAnalyses) {
    const line = [
      analysis.developer,
      analysis.overallScore.toString(),
      analysis.technicalQuality.toString(),
      analysis.communication.toString(),
      analysis.collaboration.toString(),
      analysis.delivery.toString(),
      `"${analysis.examples[0] || 'None'}"`,
      `"${analysis.suggestions[0] || 'None'}"`,
    ].join(',');
    lines.push(line);
  }

  return lines.join('\n');
}

export function formatDeveloperAnalysis(analysis: any): string {
  const lines: string[] = [];
  
  lines.push('================================================================================');
  lines.push('COMPREHENSIVE DEVELOPER ANALYSIS REPORT');
  lines.push('================================================================================');
  lines.push(`Developer: ${analysis.username}`);
  lines.push(`Analysis Date: ${analysis.analysisDate.toISOString().split('T')[0]}`);
  lines.push(`Period: Last ${analysis.scope.days} days`);
  lines.push(`Processing Time: ${Math.round(analysis.processingTime / 1000)}s`);
  lines.push('');

  // Discovery Summary
  lines.push('📊 ACTIVITY DISCOVERY');
  lines.push('----------------------------------------');
  lines.push(`Repositories: ${analysis.discovery.totalRepositories}`);
  lines.push(`Commits: ${analysis.discovery.totalCommits}`);
  lines.push(`Issues: ${analysis.discovery.totalIssues}`);
  lines.push(`Pull Requests: ${analysis.discovery.totalPullRequests}`);
  lines.push(`Reviews: ${analysis.discovery.totalReviews}`);
  lines.push(`Comments: ${analysis.discovery.totalComments}`);
  lines.push('');

  // Combined Score
  lines.push('🎯 OVERALL DEVELOPER SCORE');
  lines.push('----------------------------------------');
  lines.push(`Combined Score: ${analysis.combinedScore.combined.score}/10 (${(analysis.combinedScore.combined.confidence * 100).toFixed(0)}% confidence)`);
  lines.push(`Technical Weight: ${(analysis.combinedScore.combined.breakdown.technicalWeight * 100).toFixed(0)}%`);
  lines.push(`Social Weight: ${(analysis.combinedScore.combined.breakdown.socialWeight * 100).toFixed(0)}%`);
  lines.push('');

  // Technical Analysis
  if (analysis.technicalAnalysis) {
    lines.push('🔬 TECHNICAL ANALYSIS');
    lines.push('----------------------------------------');
    lines.push(`Code Complexity: ${analysis.combinedScore.technical.codeComplexity}/10`);
    lines.push(`Implementation Quality: ${analysis.combinedScore.technical.implementationQuality}/10`);
    lines.push(`Problem Solving: ${analysis.combinedScore.technical.problemSolving}/10`);
    lines.push(`Repositories Analyzed: ${analysis.technicalAnalysis.repositoriesAnalyzed}`);
    
    if (analysis.technicalAnalysis.summary) {
      lines.push(`Average Contribution Score: ${analysis.technicalAnalysis.summary.averageScore}`);
      lines.push(`Total Contributions: ${analysis.technicalAnalysis.summary.totalContributions}`);
      lines.push(`Top Score: ${analysis.technicalAnalysis.summary.topScore}`);
    }
    lines.push('');
  }

  // Social Analysis
  if (analysis.socialAnalysis) {
    lines.push('🤝 SOCIAL ANALYSIS');
    lines.push('----------------------------------------');
    lines.push(`Communication: ${analysis.combinedScore.social.communication}/10`);
    lines.push(`Collaboration: ${analysis.combinedScore.social.collaboration}/10`);
    lines.push(`Leadership: ${analysis.combinedScore.social.leadership}/10`);
    lines.push(`Delivery: ${analysis.combinedScore.social.delivery}/10`);
    lines.push('');

    if (analysis.socialAnalysis.developerAnalyses && analysis.socialAnalysis.developerAnalyses.length > 0) {
      const devAnalysis = analysis.socialAnalysis.developerAnalyses[0];
      if (devAnalysis.examples && devAnalysis.examples.length > 0) {
        lines.push('Top Examples:');
        devAnalysis.examples.slice(0, 3).forEach((example: string, index: number) => {
          lines.push(`  ${index + 1}. ${example}`);
        });
        lines.push('');
      }

      if (devAnalysis.suggestions && devAnalysis.suggestions.length > 0) {
        lines.push('Improvement Suggestions:');
        devAnalysis.suggestions.slice(0, 3).forEach((suggestion: string, index: number) => {
          lines.push(`  ${index + 1}. ${suggestion}`);
        });
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ES modules don't have require.main, use import.meta instead
// Handle both direct execution and npm link (symlink) execution
import { fileURLToPath } from 'url';

const currentFile = fileURLToPath(import.meta.url);
const isMainModule =
  process.argv[1] === currentFile ||
  (fs.lstatSync(process.argv[1]).isSymbolicLink() && fs.realpathSync(process.argv[1]) === currentFile);

if (isMainModule) {
  main().catch(error => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}

