# Performance Metrics Testing

This directory contains tools for measuring and tracking performance metrics in the Studio application.

## Running Performance Tests

To run the performance tests:

```bash
// Package the application first
npm run package

// Run the performance tests
npm run test:metrics
```

This will:
1. Package the application (to ensure testing against the production build)
2. Run the performance tests using Playwright
3. Generate a performance reports in `artifacts/performance-metrics.json` at the project root and output the results to the console

## How It Works

The performance tests simulate key user workflows and measure the time they take to complete. Currently, we measure:

- Site creation and startup time: How long it takes to create a new WordPress site and have it running

## Understanding the Results

The `performance-metrics.json` output file contains a summary of the results, example:

```json
{
  "siteCreation": 6150,
  "siteStartup": 3946
}
```
