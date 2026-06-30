import React, { useState, useEffect } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Header } from './header.js';
import { runQa, type QaResult } from '../lib/qa/qa-runner.js';

export interface QaProps {
  wxrFile: string;
  fix: boolean;
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'pass': return 'green';
    case 'warn': return 'yellow';
    case 'fail': return 'red';
    case 'error': return 'red';
    default: return 'gray';
  }
}

function Qa({ wxrFile, fix }: QaProps) {
  const app = useApp();
  const [phase, setPhase] = useState<'running' | 'done' | 'error'>('running');
  const [progress, setProgress] = useState({ current: 0, total: 0, slug: '' });
  const [result, setResult] = useState<QaResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await runQa({
          wxrFile,
          fix,
          onProgress: (current, total, slug) => {
            setProgress({ current, total, slug });
          },
        });
        setResult(r);
        setPhase('done');
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, [wxrFile, fix]);

  useEffect(() => {
    if (phase === 'done' || phase === 'error') {
      const timer = setTimeout(() => app.exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header subtitle={`qa ${wxrFile}${fix ? ' --fix' : ''}`} />

      {phase === 'running' && (
        <Box>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Comparing </Text>
          <Text bold>{progress.current}</Text>
          <Text>/{progress.total}</Text>
          {progress.slug && <Text dimColor> {progress.slug}</Text>}
        </Box>
      )}

      {phase === 'done' && result && (
        <Box flexDirection="column">
          {/* Summary line */}
          <Box>
            <Text bold>{result.pages.length} pages checked</Text>
            {result.skipped > 0 && <Text dimColor>, {result.skipped} skipped (no source URL)</Text>}
          </Box>

          {/* Grade breakdown */}
          <Box marginLeft={2} marginTop={1} flexDirection="column">
            <Text><Text color="green">{String(result.summary.pass).padStart(4)} </Text>pass</Text>
            <Text><Text color="yellow">{String(result.summary.warn).padStart(4)} </Text>warn</Text>
            <Text><Text color="red">{String(result.summary.fail).padStart(4)} </Text>fail</Text>
            {result.summary.error > 0 && (
              <Text><Text color="red">{String(result.summary.error).padStart(4)} </Text>error</Text>
            )}
            {result.summary.fixed > 0 && (
              <Text><Text color="blue">{String(result.summary.fixed).padStart(4)} </Text>fixed</Text>
            )}
          </Box>

          {/* Per-page results for non-pass grades */}
          {result.pages.filter(p => p.grade !== 'pass').length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Issues:</Text>
              <Box flexDirection="column" marginLeft={2}>
                {result.pages
                  .filter(p => p.grade !== 'pass')
                  .slice(0, 20)
                  .map((p, i) => (
                    <Box key={i} flexDirection="column">
                      <Box>
                        <Text color={gradeColor(p.grade)}>{p.grade.padEnd(5)} </Text>
                        <Text>{p.slug}</Text>
                        <Text dimColor> — text: {Math.round(p.diff.textSimilarity * 100)}%</Text>
                        {p.diff.missingImages.length > 0 && (
                          <Text dimColor>, {p.diff.missingImages.length} missing image{p.diff.missingImages.length === 1 ? '' : 's'}</Text>
                        )}
                        {p.diff.missingHeadings.length > 0 && (
                          <Text dimColor>, {p.diff.missingHeadings.length} missing heading{p.diff.missingHeadings.length === 1 ? '' : 's'}</Text>
                        )}
                      </Box>
                      {p.error && <Text dimColor>       {p.error}</Text>}
                      {p.fixed && <Text color="blue">       fixed: {p.fixed}</Text>}
                    </Box>
                  ))}
              </Box>
            </Box>
          )}

          {/* All clear */}
          {result.summary.fail === 0 && result.summary.warn === 0 && result.summary.error === 0 && (
            <Box marginTop={1}>
              <Text color="green">✓ All pages pass — extraction looks good</Text>
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

export function runQaUi(opts: QaProps): void {
  const { waitUntilExit } = render(<Qa {...opts} />);
  waitUntilExit().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
