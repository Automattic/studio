---
name: testing-wp-runtime
description: Guidelines for running wp-now to validate WordPress plugins and themes at runtime
disable-model-invocation: true
---

## When to use me

Use this skill when you need to verify that a WordPress plugin or theme loads correctly at runtime.
Do not use this skill for static linting — use `testing-php` or `testing-js` for that.

## Step 1: Determine the project mode

wp-now requires a `--mode` flag based on the project type:

- **Plugin project** (main PHP file has a `Plugin Name:` header): use `--mode=plugin`
- **Theme project** (contains `style.css` with `Theme Name:` header): use `--mode=theme`

Check the project root to determine which mode to use:

```bash
head -20 *.php style.css 2>/dev/null
```

## Step 2: Start wp-now

Start wp-now in the background on an available port:

```bash
wp-now start --mode=<plugin|theme> --port=8881 &
```

Wait a few seconds for the server to initialize, then verify it is running:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8881/
```

- HTTP 200 or 302 = server is running and WordPress loaded successfully.
- HTTP 500 = a fatal PHP error occurred — check debug log.
- Connection refused = server failed to start.

## Step 3: Check for PHP errors

After the server starts, check the WordPress debug log for errors:

```bash
find /tmp -name "debug.log" -path "*/wp-content/*" 2>/dev/null | head -1 | xargs tail -50 2>/dev/null
```

Look for:
- **Fatal errors**: Plugin or theme could not load — must be fixed.
- **Warnings/Notices**: Non-fatal but should be reported.
- **Deprecation notices**: Report but do not fix.

## Step 4: Validate HTTP responses

Test key endpoints to verify the project works:

```bash
# Homepage
curl -s -o /dev/null -w "%{http_code}" http://localhost:8881/

# wp-admin (should redirect to login)
curl -s -o /dev/null -w "%{http_code}" http://localhost:8881/wp-admin/
```

For plugins, also check if the plugin is active:

```bash
curl -s http://localhost:8881/ | grep -c "<plugin-specific-identifier>"
```

## Step 5: Clean up

Always stop wp-now when done testing:

```bash
kill $(lsof -t -i:8881) 2>/dev/null
```

## Rules

- **Always clean up**: Never leave wp-now running after testing is complete.
- **Port 8881**: Always use port 8881 to avoid conflicts.
- **Timeout**: If wp-now does not respond within 15 seconds of starting, consider it failed and kill the process.
- **Never modify business logic**: Only report issues found during runtime validation. Do not change how the code works.
- **Report format**: After testing, report results as:
  - PASS: Server started, HTTP 200, no fatal errors in debug log
  - FAIL: List specific errors (HTTP status, debug log entries, failed endpoints)
