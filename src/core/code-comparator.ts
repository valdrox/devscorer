import Anthropic from '@anthropic-ai/sdk';
import { FunctionalityComparison, Hint } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export class CodeComparator {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }

  async compareFunctionality(
    originalDiff: string,
    aiGeneratedDiff: string,
    requirements: string[]
  ): Promise<FunctionalityComparison> {
    logger.info('🔍 Comparing functionality between original diff and AI-generated diff');

    try {
      const comparisonPrompt = this.buildComparisonPrompt(originalDiff, aiGeneratedDiff, requirements);
      logger.debug(`📊 Comparison prompt: ${comparisonPrompt}`);

      const response = await this.anthropic.messages.create({
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
      const comparison = this.parseComparisonResult(analysisText);

      // Log detailed comparison results
      logger.debug(`📈 Similarity score: ${comparison.similarityScore}`);
      logger.debug(`✅ Is equivalent: ${comparison.isEquivalent}`);
      if (comparison.gaps.length > 0) {
        logger.debug(`❌ Gaps found: ${comparison.gaps.join('; ')}`);
      }
      if (comparison.differences.length > 0) {
        logger.debug(`⚠️ Differences: ${comparison.differences.join('; ')}`);
      }

      return comparison;
    } catch (error) {
      logger.error(`💥 Failed to compare functionality: ${error}`);
      return this.createFallbackComparison();
    }
  }

  private buildComparisonPrompt(originalDiff: string, aiGeneratedDiff: string, requirements: string[]): string {
    return `Compare these two git diffs to determine if they provide equivalent functionality changes.

REQUIREMENTS TO FULFILL:
${requirements.map((req, idx) => `${idx + 1}. ${req}`).join('\n')}

ORIGINAL DIFF (what the developer implemented):
\`\`\`diff
${originalDiff.substring(0, 3000)}
\`\`\`

AI-GENERATED DIFF (what Claude Code implemented):
\`\`\`diff
${aiGeneratedDiff.substring(0, 3000)}
\`\`\`

Please analyze and provide your assessment in this exact format:

EQUIVALENT: [true|false] - Whether the implementations provide the same core functionality

SIMILARITY_SCORE: [0.0-1.0] - How similar the implementations are (1.0 = identical functionality)

GAPS: [List what the AI implementation is missing compared to the original]
- Gap 1
- Gap 2
(etc.)

DIFFERENCES: [List significant differences in approach or implementation]
- Difference 1
- Difference 2
(etc.)

Focus on functional equivalence of the CHANGES rather than code style. Consider:
1. Do both diffs satisfy the same requirements?
2. Do they modify the same types of functionality?
3. Do they handle the same use cases and edge cases?
4. Are the core changes functionally equivalent even if implemented differently?
5. Note: Different file paths or variable names are acceptable if the functionality is equivalent`;
  }

  private parseComparisonResult(analysisText: string): FunctionalityComparison {
    const lines = analysisText.split('\n').map(line => line.trim());

    let isEquivalent = false;
    let similarityScore = 0.5;
    const gaps: string[] = [];
    const differences: string[] = [];

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
      } else if (line.startsWith('GAPS:')) {
        currentSection = 'gaps';
      } else if (line.startsWith('DIFFERENCES:')) {
        currentSection = 'differences';
      } else if (line.startsWith('- ') && currentSection === 'gaps') {
        const gap = line.replace('- ', '').trim();
        if (gap) {
          gaps.push(gap);
        }
      } else if (line.startsWith('- ') && currentSection === 'differences') {
        const difference = line.replace('- ', '').trim();
        if (difference) {
          differences.push(difference);
        }
      }
    }

    return {
      isEquivalent,
      similarityScore,
      gaps,
      differences,
    };
  }

  private createFallbackComparison(): FunctionalityComparison {
    return {
      isEquivalent: false,
      similarityScore: 0.3,
      gaps: ['Unable to perform detailed comparison due to API error'],
      differences: ['Comparison analysis failed'],
    };
  }

  async generateProgressiveHint(
    gaps: string[],
    differences: string[],
    hintLevel: number,
    previousHints: Hint[]
  ): Promise<Hint> {
    logger.info(`💡 Generating hint at level ${hintLevel}`);

    try {
      const hintPrompt = this.buildHintPrompt(gaps, differences, hintLevel, previousHints);

      const response = await this.anthropic.messages.create({
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

HINT LEVEL: ${hintLevel} (1=vague, 10=very specific)

PREVIOUS HINTS GIVEN:
${previousHints.map((hint, idx) => `${idx + 1}. ${hint.content}`).join('\n')}

Provide a hint that:
1. Is more specific than previous hints
2. Guides toward addressing the most critical gaps
3. Doesn't give away the complete solution
4. Is appropriate for the hint level (${hintLevel})

Hint levels guide specificity:
- Levels 1-3: General guidance about approach or missing concepts
- Levels 4-6: More specific about what needs to be implemented
- Levels 7-10: Very specific about how to implement missing functionality

Format your response as just the hint text, nothing else.`;

    return prompt;
  }

  private parseHint(hintText: string, hintLevel: number): Hint {
    const cleanHint = hintText.trim();

    let hintType: 'general' | 'specific' | 'technical';
    if (hintLevel <= 3) {
      hintType = 'general';
    } else if (hintLevel <= 6) {
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
      if (hintLevel <= 3) {
        hintContent = `Think about how to address: ${primaryGap}`;
      } else if (hintLevel <= 6) {
        hintContent = `You need to implement functionality for: ${primaryGap}`;
      } else {
        hintContent = `Specifically address this missing functionality: ${primaryGap}`;
      }
    }

    let hintType: 'general' | 'specific' | 'technical';
    if (hintLevel <= 3) {
      hintType = 'general';
    } else if (hintLevel <= 6) {
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

  calculateSimilarityScore(originalDiff: string, aiGeneratedDiff: string): number {
    const original = this.normalizeDiff(originalDiff);
    const generated = this.normalizeDiff(aiGeneratedDiff);

    if (original === generated) {
      return 1.0;
    }

    const longerLength = Math.max(original.length, generated.length);
    const shorterLength = Math.min(original.length, generated.length);

    if (longerLength === 0) {
      return 0.0;
    }

    const lengthSimilarity = shorterLength / longerLength;

    const commonChars = this.countCommonCharacters(original, generated);
    const charSimilarity = commonChars / longerLength;

    return (lengthSimilarity + charSimilarity) / 2;
  }

  private normalizeDiff(diff: string): string {
    return diff
      .split('\n')
      .filter(line => {
        // Keep only the actual change lines, ignore diff metadata
        return line.startsWith('+') || (line.startsWith('-') && !line.startsWith('+++') && !line.startsWith('---'));
      })
      .map(line => {
        // Remove the +/- prefix and normalize whitespace
        return line.substring(1).trim().toLowerCase();
      })
      .join('\n')
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private countCommonCharacters(str1: string, str2: string): number {
    const chars1 = str1.split('');
    const chars2 = str2.split('');
    const commonChars = new Set(chars1.filter(char => chars2.includes(char)));
    return commonChars.size;
  }
}
