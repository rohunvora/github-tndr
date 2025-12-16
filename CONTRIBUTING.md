# Contributing to GitHub-Tndr

Thanks for your interest in contributing! This document outlines how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Follow the setup instructions in [SETUP.md](SETUP.md)

## Development Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/github-tndr
cd github-tndr

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Fill in your API keys (see SETUP.md for details)
```

## Making Changes

1. Create a new branch for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Test locally by deploying to Vercel:
   ```bash
   npx vercel
   ```

4. Commit with a clear message:
   ```bash
   git commit -m "Add: brief description of what you added"
   ```

## Submitting a Pull Request

1. Push your branch to your fork
2. Open a Pull Request against the `main` branch
3. Describe what your PR does and why
4. Link any related issues

## Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Keep functions small and focused

## Questions?

Open an issue if you have questions or run into problems.

