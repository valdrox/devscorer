import Anthropic from '@anthropic-ai/sdk';
import { TechnicalComparison, Hint } from '../types/index.js';
import { logger, logPrompt, PromptType } from '../utils/logger.js';
import { config, getConfig } from '../utils/config.js';

export class CodeComparator {
  private anthropic: Anthropic | null = null;

  private async getAnthropic(): Promise<Anthropic> {
    if (!this.anthropic) {
      const fullConfig = await getConfig();
      this.anthropic = new Anthropic({
        apiKey: fullConfig.anthropicApiKey,
      });
    }
    return this.anthropic;
  }


  async compareTechnicalContributions(
    humanDiff: string,
    aiDiff: string,
    requirements: string[],
  ): Promise<TechnicalComparison> {
    logger.info('🔍 Comparing technical contributions with blind assessment');

    try {
      const comparisonPrompt = this.buildTechnicalComparisonPrompt(humanDiff, aiDiff, requirements);
      logPrompt(PromptType.CODE_COMPARISON, comparisonPrompt);

      const anthropic = await this.getAnthropic();
      const response = await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: comparisonPrompt,
          },
        ],
      });

      const analysisText = response.content[0].type === 'text' ? response.content[0].text : '';
      const comparison = this.parseTechnicalComparison(analysisText);

      // Log detailed comparison results
      logger.debug(`📈 Similarity score: ${comparison.similarityScore}`);
      logger.debug(`✅ Is equivalent: ${comparison.isEquivalent}`);
      logger.debug(`🏆 Superior contribution: ${comparison.superiorContribution}`);
      if (comparison.factorsThatMakeABetter.length > 0) {
        logger.debug(`🔸 Factors making A better: ${comparison.factorsThatMakeABetter.join('; ')}`);
      }
      if (comparison.factorsThatMakeBBetter.length > 0) {
        logger.debug(`🔹 Factors making B better: ${comparison.factorsThatMakeBBetter.join('; ')}`);
      }

      return comparison;
    } catch (error) {
      logger.error(`💥 Failed to compare technical contributions: ${error}`);
      return this.createFallbackTechnicalComparison();
    }
  }


  private buildTechnicalComparisonPrompt(contributionA: string, contributionB: string, requirements: string[]): string {
    return `You are a Senior Staff Engineer evaluating two different implementations of the same requirements.

REQUIREMENTS TO FULFILL:
${requirements.map((req, idx) => `${idx + 1}. ${req}`).join('\n')}

CONTRIBUTION A:
\`\`\`diff
${contributionA.substring(0, 3000)}
\`\`\`

CONTRIBUTION B:
\`\`\`diff  
${contributionB.substring(0, 3000)}
\`\`\`

As a Senior Staff Engineer, analyze what makes each contribution technically better:

FACTORS_THAT_MAKE_A_BETTER: [Technical factors that make A a superior contribution]
- Factor 1 (e.g., better error handling, more robust edge cases, cleaner architecture)
- Factor 2

FACTORS_THAT_MAKE_B_BETTER: [Technical factors that make B a superior contribution]  
- Factor 1 (e.g., more efficient algorithm, better maintainability, handles concurrency)
- Factor 2

EQUIVALENT: [true|false] - Whether both are essentially equivalent quality
SUPERIOR_CONTRIBUTION: [A|B|NEITHER] - Which is the better technical solution overall
SIMILARITY_SCORE: [0.0-1.0] - Overall functional similarity

Focus on technical engineering quality: architecture, error handling, edge cases, efficiency, maintainability, robustness, security, and scalability.`;
  }


  private parseTechnicalComparison(analysisText: string): TechnicalComparison {
    const lines = analysisText.split('\n').map(line => line.trim());

    let isEquivalent = false;
    let similarityScore = 0.5;
    let superiorContribution: 'A' | 'B' | 'NEITHER' = 'NEITHER';
    const factorsThatMakeABetter: string[] = [];
    const factorsThatMakeBBetter: string[] = [];

    let currentSection = '';

    for (const line of lines) {
      if (line.startsWith('EQUIVALENT:')) {
        const equivalentText = line.replace('EQUIVALENT:', '').trim().toLowerCase();
        isEquivalent = equivalentText === 'true';
      } else if (line.startsWith('SIMILARITY_SCORE:')) {
        const scoreText = line.replace('SIMILARITY_SCORE:', '').trim();
        const score = parseFloat(scoreText);
        if (!isNaN(score) && score >= 0 && score <= 1) {
          similarityScore = score;
        }
      } else if (line.startsWith('SUPERIOR_CONTRIBUTION:')) {
        const superiorText = line.replace('SUPERIOR_CONTRIBUTION:', '').trim().toUpperCase();
        if (['A', 'B', 'NEITHER'].includes(superiorText)) {
          superiorContribution = superiorText as 'A' | 'B' | 'NEITHER';
        }
      } else if (line.startsWith('FACTORS_THAT_MAKE_A_BETTER:')) {
        currentSection = 'factorsA';
      } else if (line.startsWith('FACTORS_THAT_MAKE_B_BETTER:')) {
        currentSection = 'factorsB';
      } else if (line.startsWith('- ') && currentSection === 'factorsA') {
        const factor = line.replace('- ', '').trim();
        if (factor) {
          factorsThatMakeABetter.push(factor);
        }
      } else if (line.startsWith('- ') && currentSection === 'factorsB') {
        const factor = line.replace('- ', '').trim();
        if (factor) {
          factorsThatMakeBBetter.push(factor);
        }
      }
    }

    return {
      factorsThatMakeABetter,
      factorsThatMakeBBetter,
      isEquivalent,
      superiorContribution,
      similarityScore,
    };
  }


  private createFallbackTechnicalComparison(): TechnicalComparison {
    return {
      factorsThatMakeABetter: ['Unable to analyze technical factors due to API error'],
      factorsThatMakeBBetter: [],
      isEquivalent: false,
      superiorContribution: 'NEITHER',
      similarityScore: 0.3,
    };
  }

  async generateProgressiveHint(
    gaps: string[],
    differences: string[],
    hintLevel: number,
    previousHints: Hint[],
  ): Promise<Hint> {
    logger.info(`💡 Generating hint at level ${hintLevel}`);

    try {
      const hintPrompt = this.buildHintPrompt(gaps, differences, hintLevel, previousHints);

      const anthropic = await this.getAnthropic();
      const response = await anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: hintPrompt,
          },
        ],
      });

      const hintText = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseHint(hintText, hintLevel);
    } catch (error) {
      logger.error(`Failed to generate hint: ${error}`);
      return this.createFallbackHint(gaps, hintLevel);
    }
  }


  private buildHintPrompt(gaps: string[], differences: string[], hintLevel: number, previousHints: Hint[]): string {
    const prompt = `Generate a progressive hint to help Claude Code improve its implementation.

IDENTIFIED GAPS:
${gaps.map(gap => `- ${gap}`).join('\n')}

SIGNIFICANT DIFFERENCES:
${differences.map(diff => `- ${diff}`).join('\n')}

HINT LEVEL: ${hintLevel} (1=look in that direction, 5=almost give away solution)

PREVIOUS HINTS GIVEN:
${previousHints.map((hint, idx) => `${idx + 1}. ${hint.content}`).join('\n')}

Provide a hint that:
1. Is more specific than previous hints
2. Guides toward addressing the most critical gaps
3. Is appropriate for the hint level (${hintLevel})

Hint levels guide specificity:
- Level 1: Point in the general direction - "consider X area"
- Level 2: Suggest approach - "think about Y pattern"
- Level 3: Be more specific - "you need to handle Z"
- Level 4: Give technical details - "implement using ABC"
- Level 5: Almost give away the solution - very specific guidance

Format your response as just the hint text, nothing else.`;

    return prompt;
  }


  private parseHint(hintText: string, hintLevel: number): Hint {
    const cleanHint = hintText.trim();

    let hintType: 'general' | 'specific' | 'technical';
    if (hintLevel <= 2) {
      hintType = 'general';
    } else if (hintLevel <= 4) {
      hintType = 'specific';
    } else {
      hintType = 'technical';
    }

    return {
      content: cleanHint,
      level: hintLevel,
      type: hintType,
    };
  }

  private createFallbackHint(gaps: string[], hintLevel: number): Hint {
    let hintContent = 'Consider reviewing the requirements more carefully';

    if (gaps.length > 0) {
      const primaryGap = gaps[0];
      if (hintLevel <= 2) {
        hintContent = `Think about how to address: ${primaryGap}`;
      } else if (hintLevel <= 4) {
        hintContent = `You need to implement functionality for: ${primaryGap}`;
      } else {
        hintContent = `Specifically address this missing functionality: ${primaryGap}`;
      }
    }

    let hintType: 'general' | 'specific' | 'technical';
    if (hintLevel <= 2) {
      hintType = 'general';
    } else if (hintLevel <= 4) {
      hintType = 'specific';
    } else {
      hintType = 'technical';
    }

    return {
      content: hintContent,
      level: hintLevel,
      type: hintType,
    };
  }


}
