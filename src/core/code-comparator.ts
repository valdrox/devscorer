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
    originalCode: string,
    aiGeneratedCode: string,
    requirements: string[]
  ): Promise<FunctionalityComparison> {
    logger.info('Comparing functionality between original and AI-generated code');

    try {
      const comparisonPrompt = this.buildComparisonPrompt(originalCode, aiGeneratedCode, requirements);
      
      const response = await this.anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: comparisonPrompt
          }
        ]
      });

      const analysisText = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseComparisonResult(analysisText);
    } catch (error) {
      logger.error(`Failed to compare functionality: ${error}`);
      return this.createFallbackComparison();
    }
  }

  private buildComparisonPrompt(originalCode: string, aiGeneratedCode: string, requirements: string[]): string {
    return `Compare these two code implementations to determine if they provide equivalent functionality.

REQUIREMENTS TO FULFILL:
${requirements.map((req, idx) => `${idx + 1}. ${req}`).join('\n')}

ORIGINAL IMPLEMENTATION:
\`\`\`
${originalCode.substring(0, 3000)}
\`\`\`

AI-GENERATED IMPLEMENTATION:
\`\`\`
${aiGeneratedCode.substring(0, 3000)}
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

Focus on functional equivalence rather than code style. Consider:
1. Do both implementations satisfy the same requirements?
2. Do they handle the same inputs and produce similar outputs?
3. Do they handle edge cases similarly?
4. Are core business logic patterns equivalent?`;
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
      differences
    };
  }

  private createFallbackComparison(): FunctionalityComparison {
    return {
      isEquivalent: false,
      similarityScore: 0.3,
      gaps: ['Unable to perform detailed comparison due to API error'],
      differences: ['Comparison analysis failed']
    };
  }

  async generateProgressiveHint(
    gaps: string[],
    differences: string[],
    hintLevel: number,
    previousHints: Hint[]
  ): Promise<Hint> {
    logger.info(`Generating hint at level ${hintLevel}`);

    try {
      const hintPrompt = this.buildHintPrompt(gaps, differences, hintLevel, previousHints);
      
      const response = await this.anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: hintPrompt
          }
        ]
      });

      const hintText = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseHint(hintText, hintLevel);
    } catch (error) {
      logger.error(`Failed to generate hint: ${error}`);
      return this.createFallbackHint(gaps, hintLevel);
    }
  }

  private buildHintPrompt(
    gaps: string[],
    differences: string[],
    hintLevel: number,
    previousHints: Hint[]
  ): string {
    let prompt = `Generate a progressive hint to help Claude Code improve its implementation.

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
      type: hintType
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
      type: hintType
    };
  }

  calculateSimilarityScore(originalCode: string, aiGeneratedCode: string): number {
    const original = this.normalizeCode(originalCode);
    const generated = this.normalizeCode(aiGeneratedCode);
    
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

  private normalizeCode(code: string): string {
    return code
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\/\/.*$/gm, '') // Remove line comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .toLowerCase();
  }

  private countCommonCharacters(str1: string, str2: string): number {
    const chars1 = str1.split('');
    const chars2 = str2.split('');
    const commonChars = new Set(chars1.filter(char => chars2.includes(char)));
    return commonChars.size;
  }
}