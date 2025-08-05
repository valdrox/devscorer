# Git Contribution Scorer

A command-line tool that measures the complexity and value of code contributions
by testing whether AI could replicate the same functionality. This provides an
objective measure of developer contributions based on intellectual complexity
rather than simple metrics like lines of code.

## How It Works

1. **Analyzes Recent Code Changes**: Clones a repository and examines
   significant commits from the last N days
2. **Extracts Business Requirements**: Uses AI to understand what each developer
   was trying to accomplish
3. **Tests AI Replication**: Asks Claude Code to implement the same
   functionality from scratch
4. **Progressive Hints**: If AI can't match the original, provides increasingly
   specific hints
5. **Scores Complexity**: Calculates a score based on how many hints were needed
   and other factors

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd devscorer

# Install dependencies
npm install

# Build the project
npm run build

# Install globally (optional)
npm link
```

## Prerequisites

1. **Node.js 18+**: Required for running the application (ES modules support)
2. **Anthropic API Key**: For Claude API access

**Note**: Claude Code SDK is included as a project dependency - no separate
installation required!

## Configuration

Create a `.env` file in the project root:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# Optional
LOG_LEVEL=info                          # debug, info, warn, error
MAX_CONCURRENT_ANALYSIS=3               # Parallel processing limit
CLAUDE_MODEL=claude-3-5-sonnet-20241022 # Claude model to use
MAX_HINTS_PER_ANALYSIS=10               # Maximum hints per contribution
SIMILARITY_THRESHOLD=0.85               # AI match threshold
```

## Usage

### Basic Analysis

```bash
# Analyze the last 7 days (default)
git-scorer https://github.com/yourcompany/yourrepo

# Analyze the last 30 days
git-scorer https://github.com/yourcompany/yourrepo --days 30

# Enable verbose logging
git-scorer https://github.com/yourcompany/yourrepo --verbose
```

### Output Formats

```bash
# Default table format (console output)
git-scorer https://github.com/yourcompany/yourrepo

# JSON format
git-scorer https://github.com/yourcompany/yourrepo --format json

# CSV format
git-scorer https://github.com/yourcompany/yourrepo --format csv

# Save to file
git-scorer https://github.com/yourcompany/yourrepo --output results.json
```

### Check Configuration

```bash
# Verify Claude Code SDK is available and configuration is valid
git-scorer check
```

## Modern Git Workflow Support

This tool is designed to work with modern Git workflows:

- **Individual Commits**: Analyzes commits directly rather than requiring merge
  commits
- **Squash Merges**: Works with repositories using squash-and-merge workflows
- **Rebase Workflows**: Compatible with rebase-heavy development practices
- **Smart Filtering**: Automatically skips trivial commits (version bumps,
  formatting, etc.)

### What Gets Analyzed

The tool focuses on **significant commits** and filters out:

- Version bumps and releases
- Minor formatting and linting changes
- Documentation-only updates
- Automated commits (CI/CD)

## Understanding the Scores

### Score Ranges

- **0-10**: Trivial changes that AI can easily replicate
- **11-25**: Simple implementations following standard patterns
- **26-50**: Moderate complexity requiring some domain knowledge
- **51-75**: Complex solutions with creative problem-solving
- **76-100**: Expert-level implementations with deep insight

### Score Components

1. **Base Complexity**: Lines changed, files modified, code patterns
2. **Hint Complexity**: Number and specificity of hints needed
3. **Attempt Penalty**: How many tries Claude Code needed
4. **Difficulty Bonus**: Extra points for AI-resistant implementations

## Example Output

```
================================================================================
GIT CONTRIBUTION SCORER REPORT
================================================================================
Repository: https://github.com/yourcompany/yourrepo
Analysis Date: 2025-01-15
Period: Last 7 days
Total Contributions: 12
Average Score: 34.2

TOP PERFORMERS:
----------------------------------------
1. alice.developer
2. bob.engineer
3. charlie.coder

COMPLEXITY DISTRIBUTION:
----------------------------------------
trivial (0-10): 2 contributions (16.7%)
simple (11-25): 4 contributions (33.3%)
moderate (26-50): 5 contributions (41.7%)
complex (51-75): 1 contributions (8.3%)
expert (76-100): 0 contributions (0.0%)

DETAILED CONTRIBUTIONS:
--------------------------------------------------------------------------------
Score | Developer      | Branch              | Description
--------------------------------------------------------------------------------
 67.5 | alice.dev      | feature/auth-system | Implement OAuth2 integration
 45.2 | bob.eng        | fix/memory-leak     | Fix React component memory leak
 38.7 | charlie.code   | feature/api-cache   | Add Redis caching layer
...
```

## Development

### Running Tests

```bash
npm test
npm run test:watch
```

### Building

```bash
npm run build
npm run clean  # Clean build directory
```

### Linting

```bash
npm run lint
```

## Architecture

```
src/
├── core/
│   ├── git-analyzer.ts       # Git operations and commit analysis
│   ├── business-extractor.ts # Extract business purpose from commits
│   ├── claude-runner.ts      # Claude Code integration
│   ├── code-comparator.ts    # Compare functionality equivalence
│   └── scoring-engine.ts     # Calculate complexity scores
├── utils/
│   ├── config.ts            # Configuration management
│   ├── logger.ts            # Winston logging setup
│   └── temp-manager.ts      # Temporary file management
└── types/
    └── index.ts             # TypeScript definitions
```

## Troubleshooting

### Common Issues

1. **"Claude Code SDK is not available"**
   - Ensure dependencies are installed: `npm install`
   - Check that the build completed successfully: `npm run build`

2. **"Missing required environment variables"**
   - Set `ANTHROPIC_API_KEY` in your `.env` file
   - Get your API key from: https://console.anthropic.com/

3. **"Failed to clone repository"**
   - Ensure the repository URL is valid and accessible
   - Check if you need authentication for private repositories

4. **High memory usage**
   - Reduce `MAX_CONCURRENT_ANALYSIS` in your configuration
   - Use a smaller `days` value for initial testing

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
git-scorer https://github.com/yourcompany/yourrepo --debug
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run `npm test` and `npm run lint`
6. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Security

- API keys are stored as environment variables only
- Temporary directories are cleaned up automatically
- No sensitive data is logged or stored permanently
- Repository clones are isolated in temporary directories

## Roadmap

- [ ] Support for additional git hosting platforms
- [ ] Integration with GitHub Actions for automated scoring
- [ ] Web dashboard for team analytics
- [ ] Support for additional programming languages
- [ ] Machine learning model for improved scoring accuracy
