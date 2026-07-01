import React, { useState, useEffect } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { createInterface } from 'readline';
import { Header } from './header.js';
import { validateWpConnection, type WpSetupReport } from '../lib/setup/wp-setup.js';

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function Setup({ site, username, token }: { site: string; username: string; token: string }) {
  const app = useApp();
  const [phase, setPhase] = useState<'checking' | 'done' | 'error'>('checking');
  const [report, setReport] = useState<WpSetupReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await validateWpConnection({ site, username, token });
        setReport(r);
        setPhase('done');
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, [site, username, token]);

  useEffect(() => {
    if (phase === 'done' || phase === 'error') {
      const timer = setTimeout(() => app.exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header subtitle="WordPress Setup" />

      {phase === 'checking' && (
        <Box>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Checking WordPress connection...</Text>
        </Box>
      )}

      {phase === 'done' && report && (
        <Box flexDirection="column">
          <Box>
            <Text color={report.siteReachable ? 'green' : 'red'}>
              {report.siteReachable ? '✓' : '✗'}
            </Text>
            <Text> Site reachable: </Text>
            <Text bold>{report.siteUrl}</Text>
          </Box>

          <Box>
            <Text color={report.restApiAvailable ? 'green' : 'red'}>
              {report.restApiAvailable ? '✓' : '✗'}
            </Text>
            <Text> REST API: </Text>
            <Text>{report.restApiAvailable ? 'available' : 'not available'}</Text>
            {report.siteName && <Text dimColor> ({report.siteName})</Text>}
          </Box>

          <Box>
            <Text color={report.authenticated ? 'green' : 'red'}>
              {report.authenticated ? '✓' : '✗'}
            </Text>
            <Text> Authentication: </Text>
            <Text>{report.authenticated ? `logged in as ${report.userName}` : 'failed'}</Text>
          </Box>

          {report.errors.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {report.errors.map((e, i) => (
                <Text key={i} color="red">  {e}</Text>
              ))}
            </Box>
          )}

          {report.guidance.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>How to fix:</Text>
              <Box flexDirection="column" marginLeft={2}>
                {report.guidance.map((g, i) => (
                  <Text key={i}>  {i + 1}. {g}</Text>
                ))}
              </Box>
            </Box>
          )}

          {report.authenticated && (
            <Box marginTop={1}>
              <Text color="green">✓ WordPress connection ready — you can now run import</Text>
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

export async function runSetup(opts: { site?: string; username?: string; token?: string }): Promise<void> {
  const site = opts.site || await ask('WordPress site domain (e.g. mysite.com or localhost:8881): ');
  if (!site) { console.log('Aborted.'); return; }

  const username = opts.username || await ask('WordPress username: ');
  if (!username) { console.log('Aborted.'); return; }

  const token = opts.token || process.env.WP_APP_PASSWORD || await ask('Application password (or set WP_APP_PASSWORD): ');
  if (!token) { console.log('Aborted.'); return; }

  const { waitUntilExit } = render(<Setup site={site} username={username} token={token} />);
  await waitUntilExit().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
