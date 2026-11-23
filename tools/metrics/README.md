# Performance Metrics Testing

This directory contains tools for measuring and tracking performance metrics in the Studio application.

## Running Performance Tests

To run the performance tests:

```bash
# Package the application first
npm run package

# Run the performance tests
npm run test:metrics
```

This will:

1. Package the application (to ensure testing against the production build)
2. Run the performance tests using Playwright
3. Generate a performance reports in `tools/metrics/artifacts/performance-metrics.json` and output the results to the console

## How It Works

The performance tests simulate key user workflows and measure the time they take to complete. Currently, we measure:

- **siteCreation**: How long it takes to create a new WordPress site and have it running
- **siteStartup**: How long it takes to restart an existing site
- **siteEditorLoad**: How long it takes to load the site editor (from navigation until the first block appears)

Two suites measure something other than time:

- **appSizeMac**: The size of the packaged app, in bytes
- **memoryIdle** and **memoryPeak**: The memory of everything Studio runs, in bytes: the app, the CLI, the site servers and the browser behind the agent tools. The test opens the app, creates a site, and takes three screenshots of it through the packaged CLI's MCP server. `memoryPeak` is the highest total seen on the way. `memoryIdle` is the total at the end, when the app is open, the site runs and the browser waits for the next call. The test prints the split by part. The total adds up the resident memory of each process, and processes share memory, so it is higher than Studio's real use; it is for comparing builds, not for sizing a machine

## Comparing Performance Between Commits

You can compare performance metrics between different commits or branches:

```bash
npm -w compare-perf run compare -- perf <commit1> <commit2>
```

This tool is useful for:

- Testing performance impact of code changes
- Identifying performance regressions
- Benchmarking improvements in new features

## CodeVitals Integration

Performance metrics from the `trunk` branch are automatically sent to [CodeVitals](https://www.codevitals.run/project/studio/) for tracking and visualization. This helps in tracking performance trends over time and detecting regressions.

The metrics are sent when:

1. A workflow runs on the `trunk` branch
2. The `CODEVITALS_AUTH_TOKEN` secret is available in the GitHub repository

Note that the job sends the metrics for the current command and a reference commit as well. This allows CodeVitals to compare the performance metrics between the two commits and normalize the current commit's values to avoid the CI fluctuations.

## Understanding the Results

The `performance-metrics.json` output file contains a summary of the results, example:

```json
{
	"siteCreation": 6150,
	"siteStartup": 3946
}
```

Times are in milliseconds (ms), sizes and memory are in bytes, and lower values indicate better performance.
