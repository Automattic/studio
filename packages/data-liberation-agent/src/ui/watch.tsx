//
// Watch TUI — Ink rendering for the streaming `pnpm run liberate <url>` flow
// =========================================================================
//
// Drives the orchestration in `runWatch` (watch.ts) via its events callback
// and renders the state as a live Ink interface:
//
//   ┌─ header (logo + URL + agent + platform)
//   ├─ phase indicator (spinner + label)
//   ├─ stats (URLs discovered / observed, items extracted)
//   ├─ adapter log tail (last few log lines from the extraction loop)
//   ├─ judgment queue (judgmentNeeded markers + their invocation status)
//   └─ footer (final summary or errors)
//
// Agent selection: when no flag/env is set and stdin is a TTY, the TUI shows
// an in-render select prompt before kicking off runWatch. NO_AGENT picked
// here means deterministic-only mode for the run.
//
import React, { useEffect, useState } from 'react';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { render, Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { Header } from './header.js';
import { platformColor, confidenceBadge, pluralize } from './format.js';
import { runWatch, type WatchOpts, type WatchPhase, type WatchEvents } from './watch-runner.js';
import {
  resolveAgent,
  isNoAgent,
  NO_AGENT,
  type AgentSelection,
  type AgentInvokeResult,
} from '../cli/agent-invoker.js';
import type { JudgmentNeeded } from '../lib/streaming/tick-scheduler.js';

const PHASE_LABELS: Record<WatchPhase, string> = {
  'resolving-agent': 'Setting things up…',
  'resetting': 'Clearing previous run…',
  'detecting': 'Detecting platform…',
  'discovering': 'Discovering URLs…',
  'extracting': 'Extracting content…',
  'starting-preview': 'Starting the preview site…',
  'tick-drain': 'Reviewing what was found…',
  'invoking-judgments': 'Updating the site…',
  'done': 'Done',
  'error': 'Error',
};

/**
 * User-facing label for a judgment marker. Hides internal kind/archetype
 * jargon ("theme-piece", "archetype-template", "foundation-rev") behind plain language.
 *
 * `foundationExists` flips the foundation-rev label between
 * "Determining" (first time) and "Refreshing" (after the foundation file
 * has been generated).
 */
export function describeJudgment(j: JudgmentNeeded, foundationExists: boolean): string {
  if (j.kind === 'theme-piece') {
    const piece = j.inputs.themePiece;
    if (piece === 'foundation') return 'Generating theme foundation';
    if (piece === 'header') return 'Generating header';
    if (piece === 'footer') return 'Generating footer';
    if (piece === 'homepage') return 'Generating home page';
    return 'Generating theme checkpoint';
  }
  if (j.kind === 'archetype-template') {
    const a = j.archetype;
    if (a === 'page') return 'Designing the page layout';
    if (a === 'post') return 'Designing the blog post layout';
    if (a === 'product') return 'Designing the product page layout';
    if (a === 'gallery') return 'Designing the gallery layout';
    if (a === 'event') return 'Designing the event page layout';
    if (a === 'homepage') return 'Designing the homepage';
    return `Designing the ${a ?? 'page'} layout`;
  }
  if (j.kind === 'foundation-rev') {
    return foundationExists
      ? 'Refreshing site colors and typography'
      : 'Determining site colors and typography';
  }
  return 'Updating the site';
}

interface AgentChoice {
  label: string;
  value: AgentSelection;
}

const AGENT_CHOICES: AgentChoice[] = [
  { label: 'claude', value: 'claude' },
  { label: 'codex', value: 'codex' },
  { label: 'gemini', value: 'gemini' },
  { label: 'None — deterministic only (no AI invocations)', value: NO_AGENT },
];

interface AgentSelectorProps {
  onSelect: (agent: AgentSelection) => void;
}

function AgentSelector({ onSelect }: AgentSelectorProps) {
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(AGENT_CHOICES.length - 1, i + 1));
    else if (key.return) onSelect(AGENT_CHOICES[index].value);
  });

  return (
    <Box flexDirection="column" marginY={1} paddingX={2}>
      <Text bold>Select agent CLI:</Text>
      <Text dimColor>(↑/↓ to move, Enter to confirm)</Text>
      <Box flexDirection="column" marginTop={1}>
        {AGENT_CHOICES.map((c, i) => (
          <Text key={c.label} color={i === index ? 'cyan' : undefined}>
            {i === index ? '> ' : '  '}
            {c.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

interface PhaseProps {
  phase: WatchPhase;
  done: boolean;
}

function PhaseIndicator({ phase, done }: PhaseProps) {
  const isError = phase === 'error';
  const showSpinner = !done && !isError;
  return (
    <Box>
      <Text color={isError ? 'red' : done ? 'green' : 'cyan'}>
        {showSpinner ? <Spinner type="dots" /> : isError ? '✗' : '✓'}
      </Text>
      <Text> {PHASE_LABELS[phase]}</Text>
    </Box>
  );
}

interface ArchetypeBucket {
  archetype: string;
  count: number;
}

interface WatchAppProps {
  url: string;
  watchOpts: WatchOpts;
  onComplete: (ok: boolean) => void;
}

function WatchApp({ url, watchOpts, onComplete }: WatchAppProps) {
  const app = useApp();
  // Whether we still need to resolve the agent via in-TUI select. Skipped
  // when --agent flag, DLA_AGENT_CLI, or --no-agent is already set.
  const needsAgentPick = watchOpts.agent === null && resolveAgent({}) === null && process.stdin.isTTY;
  // When the picker isn't available (no TTY, or --agent / DLA_AGENT_CLI
  // already set), default to whatever was passed. If nothing was passed
  // AND there's no TTY, fall through to NO_AGENT so runWatch actually
  // runs (otherwise the TUI hangs forever on `agentPicked === null`).
  const [agentPicked, setAgentPicked] = useState<AgentSelection | null>(
    needsAgentPick ? null : (watchOpts.agent ?? resolveAgent({}) ?? NO_AGENT),
  );
  const [phase, setPhase] = useState<WatchPhase>('resolving-agent');
  const [platform, setPlatform] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const [signals, setSignals] = useState<string[]>([]);
  const [discoveredCount, setDiscoveredCount] = useState<number | null>(null);
  const [inventoryCounts, setInventoryCounts] = useState<Record<string, number> | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number; url: string } | null>(null);
  /** Screenshot pool progress — runs in parallel with extraction. Hidden once all screenshots have completed (current === total). */
  const [screenshotProgress, setScreenshotProgress] = useState<{ current: number; total: number; url: string } | null>(null);
  const [observedByArchetype, setObservedByArchetype] = useState<ArchetypeBucket[]>([]);
  /** Preview boot status: idle → starting (boot in flight) → ready (URL set) | failed. */
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'starting' | 'ready' | 'failed'>('idle');
  /** Live preview URL — pinned in the header as soon as the site is up. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<'studio' | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** True once the design-foundation has been generated (governs Determining vs Refreshing wording). Seeded from disk so re-runs against an existing project start with "Refreshing". */
  const [foundationExists, setFoundationExists] = useState(() => {
    try {
      return existsSync(join(watchOpts.outputDir, 'design-foundation.json'));
    } catch {
      return false;
    }
  });
  /** Total number of design tasks queued (across the whole run). */
  const [designTaskTotal, setDesignTaskTotal] = useState(0);
  /**
   * What the run is doing for / because of the current URL — judgment work
   * (foundation-rev / theme-piece / archetype-template) or compose-page-blocks. Rendered
   * indented beneath the URL progress line. Null when nothing is in flight.
   */
  const [currentActivity, setCurrentActivity] = useState<string | null>(null);
  /** Running tallies for the final summary. */
  const [designTasksDone, setDesignTasksDone] = useState(0);
  const [designTasksFailed, setDesignTasksFailed] = useState(0);
  const [designTasksSkipped, setDesignTasksSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resetRemoved, setResetRemoved] = useState<string[] | null>(null);
  const [summary, setSummary] = useState<{ ok: boolean; durationMs: number; processedUrls: number; judgmentsHandled: number; judgmentsSkipped: number } | null>(null);

  useEffect(() => {
    if (agentPicked === null) return;  // wait for TUI agent selection
    let cancelled = false;

    const events: WatchEvents = {
      onPhase: (p) => { if (!cancelled) setPhase(p); },
      onAgentResolved: () => { /* TUI already shows the picked agent */ },
      onResetCompleted: (removed) => { if (!cancelled) setResetRemoved(removed); },
      onPlatformDetected: (p, c, sigs) => {
        if (cancelled) return;
        setPlatform(p);
        setConfidence(c);
        setSignals(sigs);
      },
      onUrlsDiscovered: (count) => { if (!cancelled) setDiscoveredCount(count); },
      onInventoryCounts: (counts) => { if (!cancelled) setInventoryCounts(counts); },
      onExtractionProgress: (current, total, url) => {
        if (cancelled) return;
        setExtractionProgress({ current, total, url });
      },
      onScreenshotProgress: (current, total, url) => {
        if (cancelled) return;
        setScreenshotProgress({ current, total, url });
      },
      onAdapterLog: () => { /* parsed structured progress lines instead */ },
      onPreviewStarting: () => { if (!cancelled) setPreviewStatus('starting'); },
      onPreviewReady: (info) => {
        if (cancelled) return;
        setPreviewUrl(info.url);
        setPreviewSource(info.source);
        setPreviewStatus('ready');
      },
      onPreviewFailed: (msg) => {
        if (cancelled) return;
        setPreviewError(msg);
        setPreviewStatus('failed');
      },
      onUrlObserved: (_url, archetype) => {
        if (cancelled) return;
        setObservedByArchetype((buckets) => {
          const existing = buckets.find((b) => b.archetype === archetype);
          if (existing) {
            return buckets.map((b) => b === existing ? { ...b, count: b.count + 1 } : b);
          }
          return [...buckets, { archetype, count: 1 }];
        });
      },
      onJudgmentsReady: (js) => { if (!cancelled) setDesignTaskTotal((n) => n + js.length); },
      onJudgmentStarted: (j) => {
        if (cancelled) return;
        setCurrentActivity(describeJudgment(j, foundationExists));
      },
      onJudgmentInvoked: (j, result: AgentInvokeResult) => {
        if (cancelled) return;
        const ok = result.exitCode === 0 && !result.timedOut;
        setCurrentActivity(null);
        if (ok) {
          setDesignTasksDone((n) => n + 1);
          // Foundation just got generated — subsequent foundation-revs say "Refreshing".
          if (j.kind === 'foundation-rev') setFoundationExists(true);
        } else {
          setDesignTasksFailed((n) => n + 1);
        }
      },
      onJudgmentSkipped: () => {
        if (!cancelled) setDesignTasksSkipped((n) => n + 1);
      },
      onComposePageStarted: (_url, archetype) => {
        if (cancelled) return;
        const label = archetype === 'product' ? 'Composing the product page'
          : archetype === 'post' ? 'Composing the blog post'
          : archetype === 'gallery' ? 'Composing the gallery'
          : archetype === 'event' ? 'Composing the event page'
          : archetype === 'homepage' ? 'Composing the homepage'
          : 'Composing the page';
        setCurrentActivity(label);
      },
      onComposePageCompleted: () => {
        if (!cancelled) setCurrentActivity(null);
      },
      onError: (msg) => { if (!cancelled) setError(msg); },
    };

    runWatch({ ...watchOpts, agent: agentPicked, events })
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        onComplete(result.ok);
        // Give the user a beat to read the final state, then exit.
        setTimeout(() => app.exit(), 500);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        setPhase('error');
        onComplete(false);
        setTimeout(() => app.exit(), 500);
      });

    return () => { cancelled = true; };
  }, [agentPicked]);

  if (needsAgentPick && agentPicked === null) {
    return (
      <Box flexDirection="column">
        <Header subtitle={`liberate ${url}`} />
        <AgentSelector onSelect={setAgentPicked} />
      </Box>
    );
  }

  const totalObserved = observedByArchetype.reduce((sum, b) => sum + b.count, 0);
  const isDone = phase === 'done';
  const truncateUrl = (u: string, max = 60) => (u.length > max ? '…' + u.slice(-(max - 1)) : u);

  return (
    <Box flexDirection="column">
      <Header subtitle={`liberate ${url}`} />

      {/* Agent + live preview URL + reset banner — pinned above platform info */}
      <Box flexDirection="column" paddingX={2} marginBottom={1}>
        <Box>
          <Text bold>Agent: </Text>
          <Text color={isNoAgent(agentPicked) ? 'yellow' : 'cyan'}>
            {isNoAgent(agentPicked) ? 'NONE (deterministic only)' : String(agentPicked)}
          </Text>
        </Box>
        {previewStatus === 'starting' && (
          <Box>
            <Text bold>Preview: </Text>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text dimColor> Starting the preview site…</Text>
          </Box>
        )}
        {previewStatus === 'ready' && previewUrl && (
          <Box>
            <Text bold color="green">Preview: </Text>
            <Text color="cyan" underline>{previewUrl}</Text>
            {previewSource && (
              <Text dimColor> ({previewSource})</Text>
            )}
          </Box>
        )}
        {previewStatus === 'failed' && previewError && (
          <Box>
            <Text bold color="yellow">Preview: </Text>
            <Text dimColor>{previewError}</Text>
          </Box>
        )}
        {resetRemoved && (
          <Box>
            <Text bold color="yellow">Reset: </Text>
            <Text dimColor>removed {resetRemoved.length} item(s)</Text>
          </Box>
        )}
      </Box>

      {/* Platform — color + confidence badge + reason from signals[0] (matches discover.tsx) */}
      <Box paddingX={2}>
        {phase === 'detecting' ? (
          <>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text> Detecting platform…</Text>
          </>
        ) : platform ? (
          <>
            <Text color="green">✓</Text>
            <Text> Platform: </Text>
            <Text bold color={platformColor(platform)}>
              {platform === 'unknown' ? 'Unknown' : platform}
            </Text>
            {confidence && (
              <Text dimColor> {confidenceBadge(confidence)} {confidence}</Text>
            )}
            {signals.length > 0 && (
              <Text dimColor> ({signals[0]})</Text>
            )}
          </>
        ) : null}
      </Box>

      {/* Sitemap + URL count summary — mirrors discover.tsx's "Found N URLs" line */}
      <Box paddingX={2}>
        {phase === 'discovering' ? (
          <>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text> Discovering content…</Text>
          </>
        ) : discoveredCount !== null ? (
          <>
            <Text color="green">✓</Text>
            <Text> Found </Text>
            <Text bold>{discoveredCount}</Text>
            <Text> URLs</Text>
          </>
        ) : null}
      </Box>

      {/* Inventory breakdown (per-archetype counts, sorted desc) */}
      {inventoryCounts && Object.keys(inventoryCounts).length > 0 && (
        <Box flexDirection="column" marginTop={1} marginLeft={4}>
          {Object.entries(inventoryCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <Box key={type}>
                <Text dimColor>{String(count).padStart(4)} </Text>
                <Text>{pluralize(type, count)}</Text>
              </Box>
            ))}
        </Box>
      )}

      {/* Screenshot progress — runs in parallel with extraction. Stays
        * visible until the screenshot pool finishes (current === total),
        * then disappears so the extraction line owns the row. The pool
        * (concurrency=6) feeds the extraction worker as each URL's
        * capture completes, so the user sees screenshots leading
        * extraction by some delta and then both racing to the end. */}
      {phase === 'extracting' && screenshotProgress && screenshotProgress.current < screenshotProgress.total && (
        <Box paddingX={2}>
          <Text color="magenta"><Spinner type="dots" /></Text>
          <Text> Capturing </Text>
          <Text bold>{screenshotProgress.current}</Text>
          <Text>/{screenshotProgress.total}</Text>
          <Text dimColor> {truncateUrl(screenshotProgress.url)}</Text>
        </Box>
      )}

      {/* URL progress line + sub-activity beneath. Sub-activity is whichever
        * judgment / compose work is happening for the current URL. */}
      {phase === 'extracting' && extractionProgress && (
        <Box flexDirection="column" paddingX={2}>
          <Box>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text> Extracting </Text>
            <Text bold>{extractionProgress.current}</Text>
            <Text>/{extractionProgress.total}</Text>
            <Text dimColor> {truncateUrl(extractionProgress.url)}</Text>
          </Box>
          {currentActivity && (
            <Box marginLeft={3}>
              <Text color="cyan"><Spinner type="dots" /></Text>
              <Text dimColor> {currentActivity}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Phase indicator for phases without dedicated rendering above */}
      {phase !== 'detecting' && phase !== 'discovering' && phase !== 'extracting' && (
        <Box paddingX={2}>
          <PhaseIndicator phase={phase} done={isDone} />
        </Box>
      )}

      {/* Final per-archetype summary (only shown after extraction completes) */}
      {isDone && observedByArchetype.length > 0 && (
        <Box flexDirection="column" marginY={1} paddingX={2}>
          <Text bold>Observed ({totalObserved} URLs):</Text>
          {observedByArchetype.map((b) => (
            <Text key={b.archetype}>  {b.archetype}: {b.count}</Text>
          ))}
        </Box>
      )}

      {/* Activity that happens outside the per-URL extraction loop (e.g.,
       * design judgments triggered after the final tick drain) renders
       * standalone here. Per-URL activity is shown inline below the URL
       * progress line above. */}
      {phase !== 'extracting' && currentActivity && (
        <Box paddingX={2}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> {currentActivity}</Text>
        </Box>
      )}

      {error && (
        <Box marginY={1} paddingX={2}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {summary && (
        <Box flexDirection="column" marginY={1} paddingX={2}>
          <Text bold color={summary.ok ? 'green' : 'red'}>
            {summary.ok ? '✓ Done' : '✗ Done with errors'}
          </Text>
          <Text dimColor>
            {summary.processedUrls} URLs extracted · {Math.round(summary.durationMs / 1000)}s
          </Text>
          {designTaskTotal > 0 && (
            <Text dimColor>
              {designTasksDone} design update{designTasksDone === 1 ? '' : 's'} applied
              {designTasksSkipped > 0 ? ` · ${designTasksSkipped} skipped` : ''}
              {designTasksFailed > 0 ? ` · ${designTasksFailed} failed` : ''}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Render the watch TUI for `pnpm run liberate <url>`. Returns a promise that
 * resolves after the run completes (or errors out). Rejects only on Ink
 * render failures; orchestration errors surface via the `ok` flag.
 */
export function renderWatch(opts: WatchOpts): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    let ok = true;
    const { waitUntilExit } = render(
      <WatchApp
        url={opts.url}
        watchOpts={opts}
        onComplete={(success) => { ok = success; }}
      />,
    );
    waitUntilExit().then(() => resolve({ ok }));
  });
}
