import Anthropic from '@anthropic-ai/sdk';
import { FunctionalityComparison, TechnicalComparison, Hint } from '../types/index.js';
import { logger } from '../utils/logger.js';
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

  async compareFunctionality(
    originalDiff: string,
    aiGeneratedDiff: string,
    requirements: string[],
  ): Promise<FunctionalityComparison> {
    logger.info('🔍 Comparing functionality between original diff and AI-generated diff');

    try {
      const comparisonPrompt = this.buildComparisonPrompt(originalDiff, aiGeneratedDiff, requirements);
      logger.debug(`📊 Comparison prompt: ${comparisonPrompt}`);

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

  async compareTechnicalContributions(
    humanDiff: string,
    aiDiff: string,
    requirements: string[],
  ): Promise<TechnicalComparison> {
    logger.info('🔍 Comparing technical contributions with blind assessment');

    try {
      const comparisonPrompt = this.buildTechnicalComparisonPrompt(humanDiff, aiDiff, requirements);
      logger.debug(`📊 Technical comparison prompt: ${comparisonPrompt}`);

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

  private buildComparisonPrompt(originalDiff: string, aiGeneratedDiff: string, requirements: string[]): string {
    return `Compare these two git diffs to determine if they provide equivalent FUNCTIONAL LOGIC changes.

IMPORTANT: Focus ONLY on application logic and functionality. IGNORE documentation differences.

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

EQUIVALENT: [true|false] - Whether the implementations provide the same core APPLICATION LOGIC

SIMILARITY_SCORE: [0.0-1.0] - How similar the FUNCTIONAL logic is (1.0 = identical functionality)

GAPS: [List what FUNCTIONAL logic the AI implementation is missing compared to the original]
- Gap 1
- Gap 2
(etc.)

DIFFERENCES: [List significant differences in FUNCTIONAL approach or implementation]
- Difference 1
- Difference 2
(etc.)

CRITICAL EVALUATION RULES:
1. Focus on business logic, algorithms, and functional behavior
2. IGNORE documentation differences (README, comments, docs files, etc.)
3. Consider: Do both diffs implement the same functional requirements?
4. Consider: Do they handle the same use cases and edge cases in the application logic?
5. Different file paths, variable names, or documentation are acceptable if the core functionality is equivalent
6. If the original contains ONLY documentation changes, rate EQUIVALENT=true and SIMILARITY_SCORE=1.0`;
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

  private createFallbackComparison(): FunctionalityComparison {
    return {
      isEquivalent: false,
      similarityScore: 0.3,
      gaps: ['Unable to perform detailed comparison due to API error'],
      differences: ['Comparison analysis failed'],
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

  async generateTechnicalHint(
    technicalFactors: string[],
    hintLevel: number,
    previousHints: Hint[],
  ): Promise<Hint | null> {
    // Only generate hint if there are technical improvements to be made
    if (technicalFactors.length === 0) {
      return null;
    }

    logger.info(`💡 Generating technical hint at level ${hintLevel}`);

    try {
      const hintPrompt = this.buildTechnicalHintPrompt(technicalFactors, hintLevel, previousHints);

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
      logger.error(`Failed to generate technical hint: ${error}`);
      return this.createFallbackTechnicalHint(technicalFactors, hintLevel);
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

  private buildTechnicalHintPrompt(technicalFactors: string[], hintLevel: number, previousHints: Hint[]): string {
    return `You are a Senior Staff Engineer mentoring a developer. Their current implementation is missing some important technical aspects.

TECHNICAL IMPROVEMENTS NEEDED:
${technicalFactors.map(factor => `- ${factor}`).join('\n')}

HINT LEVEL: ${hintLevel} (1=vague architectural guidance, 10=specific implementation details)
PREVIOUS HINTS: ${previousHints.map(h => h.content).join('; ')}

As a Senior Staff Engineer, provide a progressive hint that guides toward these technical improvements without giving away the solution. Focus on engineering best practices and robust implementation.

Hint levels guide specificity:
- Levels 1-3: General architectural and design principles
- Levels 4-6: More specific technical approaches and patterns
- Levels 7-10: Very specific implementation techniques and code structure

Format your response as just the hint text, nothing else.`;
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

  private createFallbackTechnicalHint(technicalFactors: string[], hintLevel: number): Hint {
    let hintContent = 'Consider reviewing the technical requirements more carefully';

    if (technicalFactors.length > 0) {
      const primaryFactor = technicalFactors[0];
      if (hintLevel <= 3) {
        hintContent = `As a Senior Staff Engineer, consider the architectural implications of: ${primaryFactor}`;
      } else if (hintLevel <= 6) {
        hintContent = `You need to implement better technical practices for: ${primaryFactor}`;
      } else {
        hintContent = `Specifically address this technical improvement: ${primaryFactor}`;
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
