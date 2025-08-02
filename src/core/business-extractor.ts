import Anthropic from '@anthropic-ai/sdk';
import { BusinessPurpose, GitMerge, GitCommit } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export class BusinessExtractor {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }

  async extractBusinessPurpose(merge: GitMerge): Promise<BusinessPurpose> {
    logger.info(`Extracting business purpose for branch: ${merge.branch}`);

    try {
      const prompt = this.buildAnalysisPrompt(merge);
      
      const response = await this.anthropic.messages.create({
        model: config.claudeModel,
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const analysisText = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseBusinessPurpose(analysisText);
    } catch (error) {
      logger.error(`Failed to extract business purpose: ${error}`);
      return this.createFallbackBusinessPurpose(merge);
    }
  }

  private buildAnalysisPrompt(merge: GitMerge): string {
    return `Analyze this git merge and extract the business purpose and requirements. 

PROJECT CONTEXT:
${merge.projectContext}

BRANCH NAME: ${merge.branch}

COMMIT MESSAGES:
${merge.commits.map(c => `- ${c.message}`).join('\n')}

CODE CHANGES SUMMARY:
${this.summarizeCodeChanges(merge.diff)}

Please provide a structured analysis in this exact format:

SUMMARY: [One sentence describing what was implemented/fixed]

REQUIREMENTS:
1. [Specific functional requirement]
2. [Another specific requirement]
3. [Continue as needed...]

TECHNICAL_CONTEXT: [Brief description of the technical approach and any frameworks/libraries used]

COMPLEXITY: [simple|moderate|complex] - Based on the technical difficulty and scope of changes

Focus on extracting clear, actionable requirements that would allow another developer to implement the same functionality.`;
  }

  private summarizeCodeChanges(diff: string): string {
    const lines = diff.split('\n');
    const summary: string[] = [];
    
    let currentFile = '';
    let addedLines = 0;
    let deletedLines = 0;
    const modifiedFiles: Set<string> = new Set();

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = match[2];
          modifiedFiles.add(currentFile);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        addedLines++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletedLines++;
      }
    }

    summary.push(`Modified ${modifiedFiles.size} files`);
    summary.push(`+${addedLines} lines, -${deletedLines} lines`);

    const filesByType = this.categorizeFiles([...modifiedFiles]);
    if (filesByType.length > 0) {
      summary.push(`File types: ${filesByType.join(', ')}`);
    }

    const codeSnippets = this.extractKeyCodeSnippets(diff);
    if (codeSnippets.length > 0) {
      summary.push('\nKey changes:');
      summary.push(...codeSnippets);
    }

    return summary.join('\n').substring(0, 1500);
  }

  private categorizeFiles(files: string[]): string[] {
    const categories: { [key: string]: number } = {};
    
    for (const file of files) {
      const ext = file.split('.').pop()?.toLowerCase();
      if (ext) {
        categories[ext] = (categories[ext] || 0) + 1;
      }
    }

    return Object.entries(categories)
      .sort(([,a], [,b]) => b - a)
      .map(([ext, count]) => count > 1 ? `${ext}(${count})` : ext)
      .slice(0, 5);
  }

  private extractKeyCodeSnippets(diff: string): string[] {
    const lines = diff.split('\n');
    const snippets: string[] = [];
    let currentContext = '';

    for (let i = 0; i < lines.length && snippets.length < 5; i++) {
      const line = lines[i];
      
      if (line.startsWith('@@')) {
        currentContext = line;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.substring(1).trim();
        
        if (this.isSignificantCode(content)) {
          snippets.push(`+ ${content.substring(0, 100)}`);
        }
      }
    }

    return snippets;
  }

  private isSignificantCode(code: string): boolean {
    if (code.length < 10) return false;
    
    const significantPatterns = [
      /function\s+\w+/,
      /class\s+\w+/,
      /interface\s+\w+/,
      /export\s+/,
      /import\s+/,
      /const\s+\w+\s*=/,
      /let\s+\w+\s*=/,
      /var\s+\w+\s*=/,
      /if\s*\(/,
      /for\s*\(/,
      /while\s*\(/,
      /return\s+/,
      /throw\s+/,
      /try\s*{/,
      /catch\s*\(/
    ];

    return significantPatterns.some(pattern => pattern.test(code));
  }

  private parseBusinessPurpose(analysisText: string): BusinessPurpose {
    const lines = analysisText.split('\n').map(line => line.trim());
    
    let summary = '';
    const requirements: string[] = [];
    let technicalContext = '';
    let complexity: 'simple' | 'moderate' | 'complex' = 'moderate';

    let currentSection = '';

    for (const line of lines) {
      if (line.startsWith('SUMMARY:')) {
        summary = line.replace('SUMMARY:', '').trim();
        currentSection = 'summary';
      } else if (line.startsWith('REQUIREMENTS:')) {
        currentSection = 'requirements';
      } else if (line.startsWith('TECHNICAL_CONTEXT:')) {
        technicalContext = line.replace('TECHNICAL_CONTEXT:', '').trim();
        currentSection = 'technical';
      } else if (line.startsWith('COMPLEXITY:')) {
        const complexityText = line.replace('COMPLEXITY:', '').trim().toLowerCase();
        if (['simple', 'moderate', 'complex'].includes(complexityText)) {
          complexity = complexityText as 'simple' | 'moderate' | 'complex';
        }
        currentSection = 'complexity';
      } else if (currentSection === 'requirements' && line.match(/^\d+\./)) {
        const requirement = line.replace(/^\d+\.\s*/, '').trim();
        if (requirement) {
          requirements.push(requirement);
        }
      } else if (currentSection === 'technical' && line && !line.startsWith('COMPLEXITY:')) {
        technicalContext += ' ' + line;
      }
    }

    return {
      summary: summary || 'Code changes without clear business purpose',
      requirements: requirements.length > 0 ? requirements : ['Implement the changes shown in the code diff'],
      technicalContext: technicalContext.trim() || 'No specific technical context identified',
      complexity
    };
  }

  private createFallbackBusinessPurpose(merge: GitMerge): BusinessPurpose {
    const branchWords = merge.branch.split(/[-_]/).filter(word => word.length > 2);
    const hasFeatureKeywords = branchWords.some(word => 
      ['feature', 'feat', 'add', 'new', 'implement'].includes(word.toLowerCase())
    );
    const hasBugKeywords = branchWords.some(word => 
      ['fix', 'bug', 'hotfix', 'patch', 'repair'].includes(word.toLowerCase())
    );

    let summary = 'Code changes';
    if (hasFeatureKeywords) {
      summary = 'Implement new feature';
    } else if (hasBugKeywords) {
      summary = 'Fix bug or issue';
    }

    const complexity: 'simple' | 'moderate' | 'complex' = 
      merge.linesChanged > 200 ? 'complex' :
      merge.linesChanged > 50 ? 'moderate' : 'simple';

    return {
      summary,
      requirements: [
        'Analyze the code changes in the diff',
        'Implement equivalent functionality',
        'Maintain the same behavior and interface'
      ],
      technicalContext: `Changes in ${merge.linesChanged} lines across multiple files`,
      complexity
    };
  }
}