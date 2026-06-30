import React, { useState, useEffect } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Header } from './header.js';
import { verifyExtraction, type VerificationReport } from '../lib/verification/verify.js';

export interface VerifyProps {
  outputDir: string;
}

function Verify({ outputDir }: VerifyProps) {
  const app = useApp();
  const [phase, setPhase] = useState<'scanning' | 'done' | 'error'>('scanning');
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await verifyExtraction(outputDir);
        setReport(r);
        setPhase('done');
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, [outputDir]);

  useEffect(() => {
    if (phase === 'done' || phase === 'error') {
      const timer = setTimeout(() => app.exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header subtitle={`verify ${outputDir}`} />

      {phase === 'scanning' && (
        <Box>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Verifying extraction...</Text>
        </Box>
      )}

      {phase === 'done' && report && (
        <Box flexDirection="column">
          <Box>
            <Text color={report.wxrFound ? 'green' : 'red'}>
              {report.wxrFound ? '✓' : '✗'}
            </Text>
            <Text> WXR file: {report.wxrFound ? 'found' : 'missing'}</Text>
          </Box>

          {report.wxrFound && (
            <Box flexDirection="column" marginLeft={2} marginTop={1}>
              <Text><Text dimColor>{String(report.pages).padStart(4)} </Text>pages</Text>
              <Text><Text dimColor>{String(report.posts).padStart(4)} </Text>posts</Text>
              <Text><Text dimColor>{String(report.mediaAttachments).padStart(4)} </Text>media attachments (WXR)</Text>
              <Text><Text dimColor>{String(report.mediaOnDisk).padStart(4)} </Text>media files on disk</Text>
              <Text><Text dimColor>{String(report.redirectCount).padStart(4)} </Text>redirects</Text>
            </Box>
          )}

          {(report.qualityScores.high + report.qualityScores.medium + report.qualityScores.low) > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Quality:</Text>
              <Box marginLeft={2} flexDirection="column">
                <Text><Text color="green">{String(report.qualityScores.high).padStart(4)} </Text>high</Text>
                <Text><Text color="yellow">{String(report.qualityScores.medium).padStart(4)} </Text>medium</Text>
                <Text><Text color="red">{String(report.qualityScores.low).padStart(4)} </Text>low</Text>
              </Box>
            </Box>
          )}

          {report.staleCdnUrls.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow">! {report.staleCdnUrls.length} stale CDN URL{report.staleCdnUrls.length === 1 ? '' : 's'} in content:</Text>
              <Box flexDirection="column" marginLeft={2}>
                {report.staleCdnUrls.slice(0, 10).map((url, i) => (
                  <Text key={i} dimColor>  {url.length > 70 ? url.slice(0, 67) + '...' : url}</Text>
                ))}
                {report.staleCdnUrls.length > 10 && (
                  <Text dimColor>  ...and {report.staleCdnUrls.length - 10} more</Text>
                )}
              </Box>
            </Box>
          )}

          {report.failedUrls.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red">✗ {report.failedUrls.length} failed URL{report.failedUrls.length === 1 ? '' : 's'}:</Text>
              <Box flexDirection="column" marginLeft={2}>
                {report.failedUrls.slice(0, 10).map((f, i) => (
                  <Text key={i} dimColor>  {f.url}: {f.error}</Text>
                ))}
              </Box>
            </Box>
          )}

          {report.failedMedia.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red">✗ {report.failedMedia.length} failed media download{report.failedMedia.length === 1 ? '' : 's'}:</Text>
              <Box flexDirection="column" marginLeft={2}>
                {report.failedMedia.slice(0, 5).map((f, i) => (
                  <Text key={i} dimColor>  {f.url}: {f.error}</Text>
                ))}
                {report.failedMedia.length > 5 && (
                  <Text dimColor>  ...and {report.failedMedia.length - 5} more</Text>
                )}
              </Box>
            </Box>
          )}

          {report.manualAttentionItems.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Needs attention:</Text>
              <Box flexDirection="column" marginLeft={2}>
                {report.manualAttentionItems.map((item, i) => (
                  <Text key={i} color="yellow">  - {item}</Text>
                ))}
              </Box>
            </Box>
          )}

          {report.manualAttentionItems.length === 0 && report.wxrFound && (
            <Box marginTop={1}>
              <Text color="green">✓ Extraction looks clean — ready to import</Text>
            </Box>
          )}
        </Box>
      )}

      {phase === 'error' && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  );
}

export function runVerify(outputDir: string): void {
  const { waitUntilExit } = render(<Verify outputDir={outputDir} />);
  waitUntilExit().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
