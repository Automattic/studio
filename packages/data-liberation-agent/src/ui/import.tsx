import React, { useState, useEffect } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { dirname } from 'node:path';
import { Header } from './header.js';
import { importToWordPress, type ImportResult } from '../lib/import/wp-importer.js';

export interface ImportProps {
  wxrFile: string;
  site: string;
  username: string;
  token: string;
  dryRun: boolean;
  delay: number;
  verbose: boolean;
  only: string | null;
  importAuthors?: boolean;
}

type Phase = 'importing' | 'done' | 'error';

interface StageProgress {
  current: number;
  total: number;
  label: string;
}

const STAGES = ['categories', 'tags', 'terms', 'media', 'pages', 'posts', 'comments', 'menus', 'products', 'variations'] as const;

// Stages that appear in the final ImportResult. `variations` is reported via
// progress callback only — Woo variations roll up under the `products` stage.
const RESULT_STAGES = ['categories', 'tags', 'terms', 'media', 'pages', 'posts', 'comments', 'menus', 'products'] as const;

function stageColor(current: number, total: number): string {
  if (total === 0) return 'gray';
  if (current === total) return 'green';
  return 'yellow';
}

function stageIcon(current: number, total: number): string {
  if (total === 0) return ' ';
  if (current === total) return '✓';
  return '›';
}

function Import(props: ImportProps) {
  const { wxrFile, site, username, token, dryRun, delay, verbose, only, importAuthors } = props;
  const app = useApp();
  const [phase, setPhase] = useState<Phase>('importing');
  const [stages, setStages] = useState<Record<string, StageProgress>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string>('');
  const [currentStage, setCurrentStage] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const importResult = await importToWordPress({
          wxrFile,
          site,
          username,
          token,
          dryRun,
          delay,
          verbose,
          only: only ?? undefined,
          importAuthors: importAuthors ?? false,
          onProgress: (stage, current, total, label) => {
            setCurrentStage(stage);
            setStages((prev) => ({
              ...prev,
              [stage]: { current, total, label },
            }));
          },
        });
        setResult(importResult);
        setPhase('done');
        setTimeout(() => app.exit(), 100);
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
        setTimeout(() => app.exit(new Error((err as Error).message)), 100);
      }
    })();
  }, [wxrFile]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header subtitle={`import → ${site}`} />

      <Box>
        <Text dimColor>WXR: {wxrFile}</Text>
      </Box>

      {/* Progress table */}
      {phase === 'importing' && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text> Importing...</Text>
          </Box>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {STAGES.map((stage) => {
              const s = stages[stage];
              if (!s) return null;
              return (
                <Box key={stage}>
                  <Text color={stageColor(s.current, s.total)}>
                    {stageIcon(s.current, s.total)}
                  </Text>
                  <Text> {stage.padEnd(12)}</Text>
                  <Text dimColor>{String(s.current).padStart(4)}/{s.total}</Text>
                  {currentStage === stage && s.current < s.total && verbose && s.label && (
                    <Text dimColor> {s.label}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Done */}
      {phase === 'done' && result && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="green">✓</Text>
            <Text> Import complete{dryRun ? ' (dry run)' : ''}</Text>
          </Box>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {RESULT_STAGES.map((stage) => {
              const s = result[stage];
              if (!s || s.total === 0) return null;
              return (
                <Box key={stage}>
                  <Text>
                    <Text dimColor>{String(s.created).padStart(4)}</Text>
                    /{s.total} {stage}
                  </Text>
                  {s.failed > 0 && (
                    <Text color="red"> ({s.failed} failed)</Text>
                  )}
                </Box>
              );
            })}
          </Box>
          {result.redirectMap.length > 0 && (
            <Box marginTop={1}>
              <Text dimColor>{result.redirectMap.length} redirect(s) mapped</Text>
            </Box>
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

export function runImport(opts: ImportProps): void {
  const { waitUntilExit } = render(<Import {...opts} />);
  waitUntilExit()
    .then(() => {
      if (opts.dryRun) return;
      const outputDir = dirname(opts.wxrFile);
      console.log('');
      console.log(`🔗 View your site: https://${opts.site}/`);
      console.log(`   Compare with preview: npm run liberate -- preview ${outputDir}`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
