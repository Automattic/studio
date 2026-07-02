import React, { useEffect, useState } from 'react';
import { render, useApp, Box, Text } from 'ink';
import { spawn as spawnProc, execFileSync } from 'node:child_process';
import { BootSpinner } from '../lib/preview/boot-spinner.js';
import { startPreview } from '../lib/preview/studio.js';
import type { PreviewSource, StartPreviewResult } from '../lib/preview/types.js';

interface RunOpts {
  outputDir: string;
  open?: boolean;
  port?: number;
  nonInteractive?: boolean;
}

function launchBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  try {
    spawnProc(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* best effort */
  }
}

/** Bring the Studio desktop app to the foreground. Best-effort per platform. */
function launchStudioApp(): boolean {
  try {
    if (process.platform === 'darwin') {
      spawnProc('open', ['-a', 'Studio'], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    if (process.platform === 'win32') {
      // `start` is a cmd.exe builtin. The empty string is the window-title
      // positional arg required when the target name contains spaces. Relies
      // on Studio being registered as a known application (the MSIX installer
      // does this); falls through to the browser path if not.
      spawnProc('cmd', ['/c', 'start', '', 'Studio'], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    if (process.platform === 'linux') {
      // Respect STUDIO_APP_CMD if set (e.g. "/path/to/Studio.AppImage" or
      // "flatpak run com.automattic.Studio"). Otherwise try a short list of
      // likely binary names. `studio` (lowercase) is deliberately excluded —
      // that's the CLI wrapper, not the desktop app.
      const customCmd = process.env.STUDIO_APP_CMD;
      if (customCmd) {
        spawnProc('sh', ['-c', customCmd], { detached: true, stdio: 'ignore' }).unref();
        return true;
      }
      for (const bin of ['Studio', 'studio-app', 'wp-studio']) {
        try {
          execFileSync('which', [bin], { stdio: 'ignore', timeout: 1000 });
          spawnProc(bin, [], { detached: true, stdio: 'ignore' }).unref();
          return true;
        } catch { /* try next */ }
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

/** Open the right thing depending on where the preview is running. */
function openPreview(result: StartPreviewResult): void {
  if (!result.url) return;
  if (result.source === 'studio' && launchStudioApp()) return;
  launchBrowser(`${result.url}/wp-admin/`);
}

/**
 * Blocking foreground Ink app used by `liberate preview <outputDir>`.
 * Waits until Ctrl+C.
 */
const PreviewApp: React.FC<RunOpts> = ({ outputDir, open }) => {
  const { exit } = useApp();
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
  const [url, setUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [source] = useState<PreviewSource>('studio');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await startPreview({ outputDir });
      if (cancelled) return;
      if (result.status === 'ready' && result.url) {
        setUrl(result.url);
        setWarnings(result.warnings ?? []);
        setStatus('ready');
        if (open) openPreview(result);
      } else {
        setError(result.error ?? 'unknown error');
        setStatus('failed');
        setTimeout(() => exit(), 10);
      }
    })();

    const onSig = () => {
      cancelled = true;
      // Studio sites persist; nothing to stop on exit.
      exit();
      process.exit(130);
    };
    process.once('SIGINT', onSig);
    process.once('SIGTERM', onSig);
    return () => {
      process.off('SIGINT', onSig);
      process.off('SIGTERM', onSig);
    };
  }, [outputDir, open, exit]);

  return (
    <Box flexDirection="column">
      <BootSpinner done={status === 'ready'} url={url} error={error} source={source} />
      {status === 'ready' && warnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">⚠ {warnings.length} warning(s) from Studio setup:</Text>
          {warnings.slice(0, 5).map((w, i) => (
            <Text key={i} color="yellow">  {w}</Text>
          ))}
          {warnings.length > 5 && <Text color="gray">  … and {warnings.length - 5} more. Check Studio's output for details.</Text>}
        </Box>
      )}
    </Box>
  );
};

export async function runCliPreview(opts: RunOpts): Promise<void> {
  const showSpinner = process.stdout.isTTY && !opts.nonInteractive;
  if (showSpinner) {
    const { waitUntilExit } = render(<PreviewApp {...opts} />);
    await waitUntilExit();
  } else {
    const result = await startPreview({ outputDir: opts.outputDir });
    if (result.status !== 'ready') {
      console.error(`[preview] failed: ${result.error}`);
      process.exit(1);
    }
    console.log(result.url);
    if (opts.open && result.url) openPreview(result);
    // Studio sites persist; nothing to stop on exit.
  }
}

/**
 * Transient Ink app for the post-extract inline preview flow.
 * Shows the boot spinner until Studio is ready, then exits the Ink render
 * (the Studio site persists). Returns the final result.
 */
const InlinePreviewApp: React.FC<{
  outputDir: string;
  onDone: (r: StartPreviewResult) => void;
}> = ({ outputDir, onDone }) => {
  const { exit } = useApp();
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
  const [url, setUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [source] = useState<PreviewSource>('studio');

  useEffect(() => {
    (async () => {
      const result = await startPreview({ outputDir });
      if (result.status === 'ready' && result.url) {
        setUrl(result.url);
        setWarnings(result.warnings ?? []);
        setStatus('ready');
      } else {
        setError(result.error ?? 'unknown error');
        setStatus('failed');
      }
      onDone(result);
      setTimeout(() => exit(), 80);
    })();
  }, [outputDir, exit, onDone]);

  return (
    <Box flexDirection="column">
      <BootSpinner done={status === 'ready'} url={url} error={error} source={source} />
      {status === 'ready' && warnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">⚠ {warnings.length} warning(s) from Studio setup:</Text>
          {warnings.slice(0, 5).map((w, i) => (
            <Text key={i} color="yellow">  {w}</Text>
          ))}
          {warnings.length > 5 && <Text color="gray">  … and {warnings.length - 5} more. Check Studio's output for details.</Text>}
        </Box>
      )}
    </Box>
  );
};

async function renderInlineSpinner(opts: RunOpts): Promise<StartPreviewResult> {
  let captured: StartPreviewResult | undefined;
  const { waitUntilExit } = render(
    <InlinePreviewApp
      outputDir={opts.outputDir}
      onDone={(r) => { captured = r; }}
    />,
  );
  // Wait for Ink to fully unmount so subsequent stdin prompts (readline)
  // don't race against Ink's keypress handlers.
  try {
    await waitUntilExit();
  } catch { /* Ink failed; treat as no result */ }
  // Ink puts stdin in raw mode and doesn't always restore it synchronously —
  // any readline prompt that runs right after (e.g. "Ready to import to
  // WordPress?") would otherwise miss keystrokes or see Enter as EOF.
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    try { process.stdin.setRawMode(false); } catch { /* best-effort */ }
  }
  return captured ?? { status: 'failed', error: 'preview spinner exited without result' };
}

/**
 * Start a Studio preview inline (during another flow such as post-extract).
 * Shows a spinner while booting, returns once the Studio site is ready.
 * The Studio site persists after this function returns.
 */
async function startInlinePreview(opts: RunOpts): Promise<StartPreviewResult> {
  const useSpinner = process.stdout.isTTY && !opts.nonInteractive;
  const result = useSpinner
    ? await renderInlineSpinner(opts)
    : await startPreview({ outputDir: opts.outputDir });

  if (result.status === 'ready' && result.url && opts.open) {
    openPreview(result);
  }
  return result;
}

/**
 * Post-extract auto-preview: spins up a local Studio site. In interactive
 * mode we also auto-launch Studio / the browser; in non-interactive mode we
 * just print the URL so scripts can capture it. `startInlinePreview` already
 * falls back to a plain startPreview when there's no TTY.
 */
export async function autoPreview(
  outputDir: string,
  opts: { nonInteractive?: boolean } = {},
): Promise<boolean> {
  const interactive = !opts.nonInteractive && process.stdout.isTTY;
  const result = await startInlinePreview({
    outputDir,
    open: interactive,
    nonInteractive: opts.nonInteractive,
  });
  if (result.status !== 'ready') {
    console.error(`[preview] failed: ${result.error ?? 'unknown error'}`);
    return false;
  }
  console.log('');
  if (result.source === 'studio') {
    console.log(`Studio site "${result.siteName}" ready at ${result.url}`);
    console.log(`Manage it: studio site list | studio site stop ${result.siteName}`);
  }
  return true;
}
