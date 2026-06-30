import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { PreviewSource } from './types.js';

export interface BootSpinnerProps {
  done?: boolean;
  url?: string;
  error?: string;
  /** Which preview backend is being booted — drives the elapsed-time labels. */
  source?: PreviewSource;
}

function phaseLabel(source: PreviewSource | undefined, elapsedMs: number): string {
  // Studio: WP is bundled with the app, so nothing is "downloaded"; the slow
  // part is `studio site create` provisioning a fresh site, then `wp import`.
  if (source === 'studio') {
    if (elapsedMs < 15_000) return 'Creating Studio site…';
    return 'Importing content…';
  }
  // source === undefined: generic progress messages shown before the source is known.
  if (elapsedMs < 10_000) return 'Downloading WordPress…';
  if (elapsedMs < 25_000) return 'Starting WordPress…';
  return 'Importing content…';
}

export function BootSpinner({ done, url, error, source }: BootSpinnerProps) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (done || error) return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 500);
    return () => clearInterval(id);
  }, [done, error]);

  if (error) {
    return (
      <Box>
        <Text color="red">❌ {error}</Text>
      </Box>
    );
  }
  if (done && url) {
    return (
      <Box>
        <Text color="green">✅ Ready at </Text>
        <Text color="cyan">{url}</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text> {phaseLabel(source, elapsed)}</Text>
    </Box>
  );
}
