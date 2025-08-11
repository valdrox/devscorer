# Contributing to DevScorer

Thanks for wanting to contribute! 

## Development Setup

```bash
# Clone and setup
git clone https://github.com/valdrox/devscorer.git
cd devscorer
npm install
npm run build
npm link  # Creates `devscorer` command for testing

# For development
npm run dev     # TypeScript compilation
npm test        # Run tests
npm run lint    # Check code style
```

## Environment Setup

Create a `.env` file for development:

```bash
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
LOG_LEVEL=debug
```

Alternative, you can use npm link and "login"
```bash
npm link
devscorer login
```

## Project Structure

```
src/
├── core/           # Main logic (git, AI, scoring)
├── auth/           # Authentication (keychain storage)
├── utils/          # Config, logging, temp files
└── index.ts        # CLI entry point
```

## Making Changes

1. Make your changes
2. Test with: `devscorer https://github.com/some/repo --limit 1 --debug`
3. Run: `npm test && npm run lint`
4. Submit a PR

That's it! No formal process - this is just a fun project.

## Testing Your Changes

```bash
# Test the CLI
devscorer check
devscorer auth-status
devscorer https://github.com/valdrox/devscorer --limit 1

# Run the test suite
npm test
```

Questions? Just open an issue!