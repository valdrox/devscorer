# DevScorer

Evaluating developer performance is notoriously difficult. This project is a proof of concept to leverage LLMs to evaluate one aspect of dev work : writing code to spec. 

The tool measures the complexity and value of code contributions by testing whether AI could replicate the same functionality. It provides an objective measure of developer contributions based on intellectual complexity rather than simple metrics like number of lines of code.

## WARNING 
This is not meant to be used in prod. It's running a copy of Claude Code locally on your computer without any sandbox! 

## Quick Start

```bash
# Install globally
npm install -g devscorer

# Authenticate with your Anthropic API key and GitHub token
devscorer login

# Evaluate a developer's performance (recommended)
devscorer evaluate <github-username> --days 30

# Or analyze a specific repository
devscorer review https://github.com/company/repo
```

## How It Works

### Developer Evaluation Mode (Recommended)

1. **Discovers Activity**: Uses GitHub API to find all repositories where the developer has been active
2. **Analyzes Code Contributions**: Clones repositories and examines significant commits using AI analysis
3. **Evaluates Social Contributions**: Analyzes GitHub issues, pull requests, reviews, and comments
4. **Combines Scores**: Generates a comprehensive developer score combining technical and social contributions
5. **Provides Insights**: Offers detailed breakdown of strengths, areas for improvement, and examples

### Repository Analysis Mode

1. **Analyzes Recent Code Changes**: Clones a repository and examines significant commits from the last N days
2. **Extracts Business Requirements**: Uses AI to understand what each developer was trying to accomplish  
3. **Tests AI Replication**: Asks Claude Code to implement the same functionality from scratch
4. **Progressive Hints**: If AI can't match the original, provides increasingly specific hints
5. **Scores Complexity**: Calculates a score based on how many hints were needed and other factors

## Prerequisites

- **Node.js 18+**: Required for running the application
- **Anthropic API Key**: Get yours from [console.anthropic.com](https://console.anthropic.com/)
- **GitHub Token**: Required for developer evaluation mode. Create a personal access token at [github.com/settings/tokens](https://github.com/settings/tokens)

## Authentication

DevScorer stores your API keys securely in your system keychain:

```bash
# Store both Anthropic API key and GitHub token securely (one-time setup)
devscorer login

# Check authentication status
devscorer auth-status

# Remove stored API keys
devscorer logout
```

For development/CI environments, you can also use environment variables:
- `ANTHROPIC_API_KEY` for Anthropic API access
- `GITHUB_TOKEN` for GitHub API access

## Usage

### Developer Evaluation (Recommended)

```bash
# Evaluate a developer's performance across all their recent activity
devscorer evaluate <github-username> --days 30

# Evaluate with specific organization scope
devscorer evaluate <github-username> --org microsoft --days 14

# Evaluate specific repositories only
devscorer evaluate <github-username> --repos "microsoft/vscode,microsoft/typescript"

# Enable debug logging to troubleshoot issues
devscorer evaluate <github-username> --days 7 --debug
```

### Repository Analysis

```bash
# Analyze the last 7 days (default)
devscorer review https://github.com/yourcompany/yourrepo

# Analyze the last 30 days
devscorer review https://github.com/yourcompany/yourrepo --days 30

# Analyze specific commit with debug output
devscorer review https://github.com/yourcompany/yourrepo --commit abc123def --debug
```

### Output Formats

```bash
# Default table format (console output)
devscorer evaluate <username>

# JSON format
devscorer evaluate <username> --format json

# Save to file
devscorer evaluate <username> --output results.json --format json
```

### System Check

```bash
# Verify configuration and dependencies
devscorer check
```

## Modern Git Workflow Support

This tool is designed to work with modern Git workflows:

- **Individual Commits**: Analyzes commits directly rather than requiring merge commits
- **Squash Merges**: Works with repositories using squash-and-merge workflows
- **Rebase Workflows**: Compatible with rebase-heavy development practices
- **Smart Filtering**: Automatically skips trivial commits (version bumps, formatting, etc.)

### What Gets Analyzed

The tool focuses on **significant commits** and filters out:

- Version bumps and releases
- Minor formatting and linting changes  
- Documentation-only updates (scored separately)
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
4. **Documentation Bonus**: Extra points for mixed logic/documentation contributions

## Example Output

```
================================================================================
DEVSCORER REPORT
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

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
devscorer https://github.com/yourcompany/yourrepo --debug
```

## Command Reference

### Main Commands

```bash
# Developer Evaluation (Comprehensive Analysis)
devscorer evaluate <github-username> [options]

# Repository Analysis (Code Contributions Only)
devscorer review <repo-url> [options]

# GitHub Social Analysis (Issues, PRs, Reviews)
devscorer github-analysis <repo-url> [options]
```

### Options

```bash
Common Options:
  -d, --days <number>     Number of days to analyze (default: 30 for evaluate, 7 for review)
  -o, --output <file>     Output file for results (JSON format)
  --format <type>         Output format: table|json|csv (default: table)
  --verbose               Enable verbose logging
  --debug                 Enable debug logging

Evaluate Options:
  --org <organization>    Limit analysis to specific organization
  --repos <repositories>  Limit analysis to specific repositories (comma-separated)
  --org-repos <org>       Analyze only repos owned by this organization
  --min-activity <number> Minimum activities required to include a repository

Review Options:
  -l, --limit <number>    Maximum commits to analyze (for testing)
  -c, --commit <hash>     Analyze specific commit by hash

Utility Commands:
  login                   Store API keys securely in system keychain
  logout                  Remove stored API keys from keychain  
  auth-status            Show authentication status
  check                  Verify configuration and dependencies
```

## Contributing

Want to contribute? See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and contribution guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Security

- API keys are stored securely in your system keychain
- Temporary directories are cleaned up automatically
- No sensitive data is logged or stored permanently
- Repository clones are isolated in temporary directories