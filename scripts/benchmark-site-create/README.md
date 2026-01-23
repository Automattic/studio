# Studio Site Create Benchmark

Benchmarks Studio CLI `site create` performance against raw Playground CLI to measure overhead.

## Related Issue

[STU-1235](https://linear.app/a8c/issue/STU-1235/studio-benchmark-studio-site-create-performance-compared-with-raw)

## Usage

```bash
cd scripts/benchmark-site-create
npm install
npm run benchmark
```

### Options

```
--rounds=N          Number of test rounds (default: 3)
--skip-playground   Skip Playground CLI benchmarks
--skip-studio       Skip Studio CLI benchmarks
--use-bundled       Use Studio's bundled WordPress files for Playground CLI
                    (for apples-to-apples comparison, requires Studio app installed)
--help              Show help message
```

### Examples

```bash
# Run 5 rounds of all benchmarks
npm run benchmark -- --rounds=5

# Only benchmark Studio CLI
npm run benchmark -- --skip-playground

# Only benchmark Playground CLI
npm run benchmark -- --skip-studio
```

## What It Measures

| Benchmark | Description |
|-----------|-------------|
| **Playground CLI (download)** | Raw `wp-playground server` - downloads WordPress and starts server |
| **Playground CLI (bundled files)** | Raw `wp-playground server` with pre-copied bundled files (use `--use-bundled`) |
| **Studio CLI (create only)** | `studio site create` without `--start` - creates site metadata and files |
| **Studio CLI (create + start)** | `studio site create --start` - full site creation including server startup |

### Default vs Bundled Mode

By default, the benchmark compares:
- **Playground CLI**: Downloads WordPress from the internet each run
- **Studio CLI**: Uses pre-bundled WordPress files (optimized)

With `--use-bundled`, both use the same bundled files for an apples-to-apples comparison of the actual overhead Studio adds on top of Playground CLI.

## Output

Results are displayed in a summary table showing:
- Min/Max/Avg/Median times
- Success rate
- Overhead percentage vs Playground CLI baseline

Results are also saved to a JSON file: `results-{platform}-{timestamp}.json`

## Running on Both Platforms

Per STU-1235, benchmarks should be run on both macOS and Windows:

### macOS
```bash
cd scripts/benchmark-site-create
npm install
npm run benchmark -- --rounds=5
```

### Windows
```powershell
cd scripts\benchmark-site-create
npm install
npm run benchmark -- --rounds=5
```

## Interpreting Results

The overhead analysis shows how much slower Studio CLI is compared to raw Playground CLI:

- **Positive overhead**: Studio adds this much time on top of Playground
- **Overhead percentage**: `(studio_time / playground_time - 1) * 100`

### Expected Overhead Sources

Based on code analysis, Studio adds overhead for:

1. **File I/O**: Appdata lock/unlock, SQLite file copying
2. **Process Management**: PM2 connection, lockfile operations
3. **IPC Messaging**: Activity tracking, message parsing
4. **Configuration**: Building filesystem mounts, blueprint injection

## Troubleshooting

### Port conflicts
The benchmark uses port 9876 for Playground. If you see port-related errors, kill any process using that port:
```bash
# macOS/Linux
lsof -ti:9876 | xargs kill -9

# Windows
netstat -ano | findstr :9876
taskkill /PID <pid> /F
```

### Studio CLI not found
Ensure the CLI is built:
```bash
cd ../..  # back to studio root
npm run cli:build
```
