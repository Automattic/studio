---
name: testing-js
description: Guidelines for checking JavaScript files for syntax errors
disable-model-invocation: true
---

## When to use me

Use this skill when validating JavaScript files for syntax errors.
Do not use this skill for PHP validation.

## Step 1: Identify JavaScript files

Find all JS files in the project, excluding `node_modules/`, `build/`, and `dist/` directories:

```bash
find . -name "*.js" -not -path "*/node_modules/*" -not -path "*/build/*" -not -path "*/dist/*"
```

## Step 2: Check syntax

Use Node to check each JS file for syntax errors:

```bash
node --check <file>
```

- A file with valid syntax exits 0 with no output.
- A file with syntax errors prints the error with line number and exits non-zero.
- Fix any syntax errors found by editing the file, then re-check.

## Rules

- **Syntax only**: This skill checks for JavaScript syntax errors. Do not run ESLint or other coding standard tools.
- **Max 3 cycles**: Run at most 3 fix-then-retest cycles per file. If issues remain after 3 cycles, report them as unresolved.
- **Never modify business logic**: Only fix syntax errors. Do not change how the code works.
- **Report format**: After testing, report results as:
  - PASS: No syntax errors
  - FAIL: List remaining errors with file, line, and message
