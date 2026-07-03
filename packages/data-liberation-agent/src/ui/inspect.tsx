import React, { useState, useEffect } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Header } from './header.js';
import { platformColor, confidenceBadge, pluralize } from './format.js';
import { detect, type FullDetectionResult } from '../lib/detect-platform/index.js';
import { fetchSitemap, classifyUrl } from '../lib/extraction/sitemap.js';

export interface InspectProps {
  url: string;
  token: string | null;
}

type Phase = 'detecting' | 'scanning' | 'probing' | 'done' | 'error';


function Inspect({ url, token }: InspectProps) {
  const app = useApp();
  const [phase, setPhase] = useState<Phase>('detecting');
  const [detection, setDetection] = useState<FullDetectionResult | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [urlCount, setUrlCount] = useState(0);
  const [probeResults, setProbeResults] = useState<unknown[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        // Phase 1: Detect platform
        const det = await detect(url);
        setDetection(det);

        // Phase 2: Scan sitemap
        setPhase('scanning');
        const urls = await fetchSitemap(url);
        setUrlCount(urls.length);

        const c: Record<string, number> = {};
        for (const u of urls) {
          const type = classifyUrl(u);
          c[type] = (c[type] || 0) + 1;
        }
        setCounts(c);

        // Phase 3: Probe sample pages (if adapter supports it)
        const { defaultAdapter } = await import('../adapters/default/index.js');
        const { shopifyAdapter } = await import('../adapters/shopify/index.js');
        const { squarespaceAdapter } = await import('../adapters/squarespace/index.js');
        const { webflowAdapter } = await import('../adapters/webflow/index.js');
        const { wixAdapter } = await import('../adapters/wix/index.js');
        const { resolveAdapter } = await import('../adapters/resolve-adapter.js');
        const allAdapters = [defaultAdapter, shopifyAdapter, squarespaceAdapter, webflowAdapter, wixAdapter];
        const adapter = resolveAdapter(allAdapters, det.platform);

        if (adapter && typeof adapter.probe === 'function' && urls.length > 0) {
          setPhase('probing');
          const results = await adapter.probe(url, urls.slice(0, 3), { token: token ?? undefined });
          setProbeResults(results);
        }

        setPhase('done');
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, [url]);

  useEffect(() => {
    if (phase === 'done' || phase === 'error') {
      const timer = setTimeout(() => app.exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const feasibility = detection?.platform === 'unknown' ? 'limited' : 'ready';

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header subtitle={`inspect ${url}`} />

      {/* Detection */}
      <Box>
        {phase === 'detecting' ? (
          <>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text> Detecting platform...</Text>
          </>
        ) : detection ? (
          <>
            <Text color="green">✓</Text>
            <Text> Platform: </Text>
            <Text bold color={platformColor(detection.platform)}>
              {detection.platform === 'unknown' ? 'Unknown' : detection.platform}
            </Text>
            <Text dimColor> {confidenceBadge(detection.confidence)} {detection.confidence}</Text>
            {detection.signals.length > 0 && (
              <Text dimColor> ({detection.signals.join(', ')})</Text>
            )}
          </>
        ) : null}
      </Box>

      {/* Sitemap scan */}
      {phase !== 'detecting' && (
        <Box>
          {phase === 'scanning' ? (
            <>
              <Text color="yellow"><Spinner type="dots" /></Text>
              <Text> Scanning sitemap...</Text>
            </>
          ) : (
            <>
              <Text color={urlCount > 0 ? 'green' : 'yellow'}>{urlCount > 0 ? '✓' : '⚠'}</Text>
              <Text> Sitemap: </Text>
              <Text bold>{urlCount}</Text>
              <Text> URLs found</Text>
            </>
          )}
        </Box>
      )}

      {/* Content breakdown */}
      {Object.keys(counts).length > 0 && phase !== 'scanning' && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <Box key={type}>
                <Text dimColor>{String(count).padStart(4)} </Text>
                <Text>{pluralize(type, count)}</Text>
              </Box>
            ))}
        </Box>
      )}

      {/* Probing */}
      {phase === 'probing' && (
        <Box marginTop={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Probing sample pages...</Text>
        </Box>
      )}

      {/* Probe results */}
      {probeResults.length > 0 && phase === 'done' && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="green">✓</Text>
            <Text> Probed {probeResults.length} sample page{probeResults.length === 1 ? '' : 's'}</Text>
          </Box>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {probeResults.map((r: any, i: number) => (
              <Box key={i}>
                <Text dimColor>  {r.url ? new URL(r.url).pathname : `page ${i + 1}`}: </Text>
                <Text color={r.extractable ? 'green' : 'red'}>{r.extractable ? 'extractable' : 'blocked'}</Text>
                {r.qualityScore && <Text dimColor> ({r.qualityScore})</Text>}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Feasibility summary */}
      {phase === 'done' && detection && (
        <Box marginTop={1}>
          {feasibility === 'ready' ? (
            <>
              <Text color="green">✓</Text>
              <Text> Extraction: </Text>
              <Text color="green" bold>ready</Text>
            </>
          ) : (
            <>
              <Text color="yellow">⚠</Text>
              <Text> Extraction: </Text>
              <Text color="yellow" bold>limited</Text>
              <Text dimColor> (unknown platform)</Text>
            </>
          )}
        </Box>
      )}

      {/* Error */}
      {phase === 'error' && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  );
}

export function runInspect(url: string, opts: Partial<InspectProps> = {}): void {
  const { waitUntilExit } = render(
    <Inspect url={url} token={opts.token || null} />,
  );
  waitUntilExit().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
