#!/bin/bash
# Data Liberation Agent — one-liner bootstrap
#
# Run with:
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/m/data-liberation-agent/main/start.sh)"
#
# Or if you have the repo cloned:
#   ./start.sh

set -e

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║   Data Liberation Agent          ║"
echo "  ║   Escape closed platforms.       ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found."
  echo ""
  echo "Install it:"
  echo "  brew install node          # macOS with Homebrew"
  echo "  https://nodejs.org         # or download directly"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required (you have $(node -v))"
  exit 1
fi

# If we're not already in the repo, clone it
if [ ! -f "cli.js" ]; then
  if [ -d "data-liberation-agent" ]; then
    echo "→ Updating existing repo..."
    cd data-liberation-agent
    git pull --quiet
  else
    echo "→ Downloading..."
    git clone --quiet https://github.com/m/data-liberation-agent.git
    cd data-liberation-agent
  fi
fi

# Install dependencies
if [ ! -d "node_modules" ]; then
  echo "→ Installing dependencies..."
  npm install --quiet 2>/dev/null
fi

# Check if Playwright browsers are installed
if ! npx playwright install --dry-run chromium &>/dev/null 2>&1; then
  echo "→ Installing browser for extraction..."
  npx playwright install chromium --quiet 2>/dev/null || true
fi

echo ""

# Hand off to the interactive CLI
exec node cli.js "$@"
