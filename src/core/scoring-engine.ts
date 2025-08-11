import { ContributionScore, Hint, AnalysisReport, GitContribution, BusinessPurpose } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class ScoringEngine {
  calculateComplexityScore(
    contribution: GitContribution,
    hintsNeeded: number,
    hints: Hint[],
    attempts: number,
    functionalityMatched: boolean,
  ): number {
    logger.debug(`Calculating complexity score for ${contribution.branch}`);

    const baseComplexity = this.calculateBaseComplexity(contribution);
    const hintComplexity = this.calculateHintComplexity(hints);
    const attemptPenalty = this.calculateAttemptPenalty(attempts, functionalityMatched);
    const difficultyBonus = this.calculateDifficultyBonus(hintsNeeded, attempts, functionalityMatched);

    const rawScore = baseComplexity + hintComplexity + attemptPenalty + difficultyBonus;

    const normalizedScore = Math.max(0, Math.min(100, rawScore));

    logger.debug(
      `Score components for ${contribution.branch}: base=${baseComplexity}, hints=${hintComplexity}, attempts=${attemptPenalty}, difficulty=${difficultyBonus}, final=${normalizedScore}`,
    );

    return Math.round(normalizedScore * 100) / 100;
  }

  private calculateBaseComplexity(contribution: GitContribution): number {
    const linesChanged = contribution.linesChanged;
    const filesModified = this.countModifiedFiles(contribution.diff);
    const commitCount = contribution.commits.length;

    let baseScore = 0;

    baseScore += Math.min(linesChanged * 0.1, 20);

    baseScore += Math.min(filesModified * 2, 15);

    baseScore += Math.min(commitCount * 1.5, 10);

    const codeComplexity = this.analyzeCodeComplexity(contribution.diff);
    baseScore += codeComplexity;

    return Math.min(baseScore, 30);
  }

  private countModifiedFiles(diff: string): number {
    const lines = diff.split('\n');
    const files = new Set<string>();

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          files.add(match[2]);
        }
      }
    }

    return files.size;
  }

  private analyzeCodeComplexity(diff: string): number {
    const lines = diff.split('\n');
    let complexityScore = 0;

    const complexPatterns = [
      { pattern: /class\s+\w+/g, weight: 3 },
      { pattern: /interface\s+\w+/g, weight: 2 },
      { pattern: /function\s+\w+/g, weight: 2 },
      { pattern: /async\s+function/g, weight: 3 },
      { pattern: /Promise\s*</g, weight: 2 },
      { pattern: /catch\s*\(/g, weight: 2 },
      { pattern: /throw\s+/g, weight: 2 },
      { pattern: /for\s*\(/g, weight: 1 },
      { pattern: /while\s*\(/g, weight: 1 },
      { pattern: /if\s*\(/g, weight: 0.5 },
      { pattern: /switch\s*\(/g, weight: 2 },
      { pattern: /regex/i, weight: 2 },
      { pattern: /\.map\s*\(/g, weight: 1 },
      { pattern: /\.filter\s*\(/g, weight: 1 },
      { pattern: /\.reduce\s*\(/g, weight: 2 },
      { pattern: /import\s+.*from/g, weight: 0.5 },
    ];

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const codeLine = line.substring(1);

        for (const { pattern, weight } of complexPatterns) {
          const matches = codeLine.match(pattern);
          if (matches) {
            complexityScore += matches.length * weight;
          }
        }
      }
    }

    return Math.min(complexityScore * 0.1, 15);
  }

  private calculateHintComplexity(hints: Hint[]): number {
    let hintScore = 0;

    for (const hint of hints) {
      switch (hint.type) {
        case 'general':
          hintScore += 5;
          break;
        case 'specific':
          hintScore += 10;
          break;
        case 'technical':
          hintScore += 15;
          break;
      }

      hintScore += hint.level * 2;
    }

    return Math.min(hintScore, 50);
  }

  private calculateAttemptPenalty(attempts: number, aiMatched: boolean): number {
    if (!aiMatched) {
      return 20;
    }

    if (attempts <= 1) {
      return -10;
    } else if (attempts <= 3) {
      return 0;
    } else if (attempts <= 5) {
      return 5;
    } else {
      return 10;
    }
  }

  private calculateDifficultyBonus(hintsNeeded: number, attempts: number, aiMatched: boolean): number {
    if (!aiMatched) {
      return 15;
    }

    let bonus = 0;

    bonus += Math.min(hintsNeeded * 3, 20);

    if (attempts > 5) {
      bonus += 5;
    }

    if (hintsNeeded > 7) {
      bonus += 10;
    }

    return bonus;
  }

  createContributionScore(
    contribution: GitContribution,
    businessPurpose: BusinessPurpose,
    finalScore: number,
    hintsNeeded: number,
    hints: Hint[],
    attempts: number,
  ): ContributionScore {
    return {
      developer: contribution.author,
      date: contribution.date,
      branch: contribution.branch,
      description: businessPurpose.summary,
      score: finalScore,
      hintsNeeded,
      details: {
        attempts,
        hints,
        baseComplexity: this.calculateBaseComplexity(contribution),
        aiDifficulty: hintsNeeded > 0 ? Math.min(hintsNeeded * 10, 50) : 0,
      },
    };
  }

  generateDetailedReport(
    repositoryUrl: string,
    daysCovered: number,
    developerScores: ContributionScore[],
  ): AnalysisReport {
    logger.info(`Generating detailed report for ${developerScores.length} contributions`);

    const summary = this.calculateSummaryStatistics(developerScores);

    return {
      repositoryUrl,
      analysisDate: new Date(),
      daysCovered,
      totalContributions: developerScores.length,
      developerScores: developerScores.sort((a, b) => b.score - a.score),
      summary,
    };
  }

  private calculateSummaryStatistics(scores: ContributionScore[]): {
    topPerformers: string[];
    averageScore: number;
    complexityDistribution: Record<string, number>;
  } {
    if (scores.length === 0) {
      return {
        topPerformers: [],
        averageScore: 0,
        complexityDistribution: {},
      };
    }

    const developerTotals = new Map<string, number>();
    const developerCounts = new Map<string, number>();

    for (const score of scores) {
      const currentTotal = developerTotals.get(score.developer) || 0;
      const currentCount = developerCounts.get(score.developer) || 0;

      developerTotals.set(score.developer, currentTotal + score.score);
      developerCounts.set(score.developer, currentCount + 1);
    }

    const developerAverages = Array.from(developerTotals.entries()).map(([developer, total]) => ({
      developer,
      average: total / (developerCounts.get(developer) || 1),
    }));

    developerAverages.sort((a, b) => b.average - a.average);

    const topPerformers = developerAverages.slice(0, 5).map(d => d.developer);

    const totalScore = scores.reduce((sum, score) => sum + score.score, 0);
    const averageScore = Math.round((totalScore / scores.length) * 100) / 100;

    const complexityDistribution = this.calculateComplexityDistribution(scores);

    return {
      topPerformers,
      averageScore,
      complexityDistribution,
    };
  }

  private calculateComplexityDistribution(scores: ContributionScore[]): Record<string, number> {
    const distribution = {
      'trivial (0-10)': 0,
      'simple (11-25)': 0,
      'moderate (26-50)': 0,
      'complex (51-75)': 0,
      'expert (76-100)': 0,
    };

    for (const score of scores) {
      if (score.score <= 10) {
        distribution['trivial (0-10)']++;
      } else if (score.score <= 25) {
        distribution['simple (11-25)']++;
      } else if (score.score <= 50) {
        distribution['moderate (26-50)']++;
      } else if (score.score <= 75) {
        distribution['complex (51-75)']++;
      } else {
        distribution['expert (76-100)']++;
      }
    }

    return distribution;
  }

  formatReportForConsole(report: AnalysisReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push('GIT CONTRIBUTION SCORER REPORT');
    lines.push('='.repeat(80));
    lines.push(`Repository: ${report.repositoryUrl}`);
    lines.push(`Analysis Date: ${report.analysisDate.toLocaleDateString()}`);
    lines.push(`Period: Last ${report.daysCovered} days`);
    lines.push(`Total Contributions: ${report.totalContributions}`);
    lines.push(`Average Score: ${report.summary.averageScore}`);
    lines.push('');

    if (report.summary.topPerformers.length > 0) {
      lines.push('TOP PERFORMERS:');
      lines.push('-'.repeat(40));
      report.summary.topPerformers.forEach((performer, idx) => {
        lines.push(`${idx + 1}. ${performer}`);
      });
      lines.push('');
    }

    lines.push('COMPLEXITY DISTRIBUTION:');
    lines.push('-'.repeat(40));
    Object.entries(report.summary.complexityDistribution).forEach(([range, count]) => {
      const percentage = ((count / report.totalContributions) * 100).toFixed(1);
      lines.push(`${range}: ${count} contributions (${percentage}%)`);
    });
    lines.push('');

    lines.push('DETAILED CONTRIBUTIONS:');
    lines.push('-'.repeat(80));
    lines.push('Score | Developer | Branch | Description');
    lines.push('-'.repeat(80));

    report.developerScores.slice(0, 20).forEach(score => {
      const scoreStr = score.score.toString().padStart(5);
      const developerStr = score.developer.substring(0, 15).padEnd(15);
      const branchStr = score.branch.substring(0, 20).padEnd(20);
      const descStr = score.description.substring(0, 35);
      lines.push(`${scoreStr} | ${developerStr} | ${branchStr} | ${descStr}`);
    });

    if (report.developerScores.length > 20) {
      lines.push(`... and ${report.developerScores.length - 20} more contributions`);
    }

    lines.push('='.repeat(80));

    return lines.join('\n');
  }
}
