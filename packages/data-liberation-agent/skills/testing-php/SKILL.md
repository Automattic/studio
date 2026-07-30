---
name: testing-php
description: Guidelines for running PHP linting to catch syntax errors
disable-model-invocation: true
---

## When to use me

Use this skill when validating PHP files for syntax errors.
Do not use this skill for JavaScript or CSS validation.

## Step 1: Identify PHP files

Find all PHP files in the project, excluding `vendor/`, `node_modules/`, and `build/` directories:

```bash
find . -name "*.php" -not -path "*/vendor/*" -not -path "*/node_modules/*" -not -path "*/build/*"
```

## Step 2: Run PHP syntax check

Check each PHP file for syntax errors using `php -l`:

```bash
php -l <file>
```

- A file with valid syntax prints `No syntax errors detected in <file>` and exits 0.
- A file with syntax errors prints the error message with line number and exits non-zero.
- Fix any syntax errors found by editing the file, then re-run `php -l` to confirm.

## Rules

- **Syntax only**: This skill checks for PHP syntax errors. Do not run PHPCS or other coding standard tools.
- **Max 3 cycles**: Run at most 3 fix-then-retest cycles per file. If issues remain after 3 cycles, report them as unresolved.
- **Never modify business logic**: Only fix syntax errors. Do not change how the code works.
- **Report format**: After testing, report results as:
  - PASS: No syntax errors
  - FAIL: List remaining errors with file, line, and message
