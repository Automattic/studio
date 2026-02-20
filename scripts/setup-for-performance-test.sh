#!/bin/bash
# Conditional setup script for performance tests
# Detects monorepo vs old structure and runs appropriate commands

set -e

echo "Detecting repository structure..."

if [ -d "apps/studio" ]; then
  echo "Monorepo structure detected"
  npm ci
  npm -w studio-cli run install:bundle
  npm -w studio-app run install:bundle
  npm run package
else
  echo "Old (pre-monorepo) structure detected"
  npm ci
  npm run package
fi
