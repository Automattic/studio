import React, { useEffect, useState } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ScreenshotOpts, ScreenshotResult } from '../lib/screenshot/types.js';
import { captureScreenshots } from '../lib/screenshot/screenshotter.js';

interface RunOpts extends ScreenshotOpts {
  urlLabel: string;
}

const ScreenshotApp: React.FC<RunOpts> = (opts) => {
  const { exit } = useApp();
  const [status, setStatus] = useState<'running' | 'done' | 'failed'>('running');
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<ScreenshotResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sink = {
      sendLoggingMessage: ({ data }: { level: string; data: string }) => {
        setLog((prev) => [...prev.slice(-6), data]);
      },
    } as unknown as ScreenshotOpts['server'];

    (async () => {
      try {
        const r = await captureScreenshots({ ...opts, server: sink });
        setResult(r);
        setStatus('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('failed');
      } finally {
        setTimeout(() => exit(), 100);
      }
    })();
    // intentional — fire once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box flexDirection="column">
      <Text>
        {status === 'running' ? <Spinner type="dots" /> : status === 'done' ? '✓' : '✗'}{' '}
        data-liberation — screenshot
      </Text>
      <Text>  Site: {opts.urlLabel}</Text>
      <Text>  URLs: {opts.urls.length}{opts.types?.length ? ` (filter: ${opts.types.join(', ')})` : ''}</Text>
      <Text>  Viewports: desktop (1440×900), mobile (390×844)</Text>
      {log.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {log.map((line, i) => (<Text key={i} dimColor>  {line}</Text>))}
        </Box>
      )}
      {status === 'done' && result && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">
            Captured {result.captured}/{opts.urls.length} in {(result.durationMs / 1000).toFixed(1)}s.
            {' '}Skipped {result.skipped}, failed {result.failed}, browser restarts {result.browserRestarts}.
            {result.failed > 0 && ` See failures.json.`}
          </Text>
        </Box>
      )}
      {status === 'failed' && (
        <Text color="red">Error: {error}</Text>
      )}
    </Box>
  );
};

export function runCliScreenshot(opts: RunOpts): void {
  render(<ScreenshotApp {...opts} />);
}
