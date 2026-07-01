//
// liberate_replicate_tick MCP handler
// ===================================
// Reads the per-outputDir replicate-state.json, computes deltas (archetypes
// observed but not yet templated; foundation drift if foundation inputs are
// available on disk), and returns `JudgmentNeeded[]` markers that the calling
// agent should act on (typically by invoking the `replicate` or
// `design-foundation` skills).
//
// The handler does NOT invoke skills directly — the MCP layer is
// deterministic by design. It also does NOT mutate the running site; that's
// `liberate_preview`'s job once the agent has produced theme files.
//
// Side effects:
//   - Updates `lastTickAt` and `lastTickReason` in `replicate-state.json` via
//     atomic rename (the underlying `ReplicateStateCache.update` call).
//   - Optionally reads `palette.json` / `typography.json` / `breakpoints.json`
//     to compute foundation drift; missing files are treated as "no drift
//     signal yet" rather than an error.
//
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadReplicateState,
  saveReplicateState,
  type ReplicateState,
} from '../../lib/streaming/replicate-state.js';
import { computeInputsDigest, driftScore } from '../../lib/streaming/foundation-drift.js';
import type { JudgmentNeeded } from '../../lib/streaming/tick-scheduler.js';
import type { Handler } from '../handler-types.js';

interface TickResponse {
  ok: boolean;
  tickReason: string | null;
  newArchetypes: string[];
  judgmentNeeded: JudgmentNeeded[];
  appliedDeltas: Array<{ kind: string; detail: string }>;
  errors: string[];
}

export const replicateTickHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string;
  if (!outputDir) {
    return ctx.errorResult('liberate_replicate_tick requires outputDir');
  }

  const start = Date.now();
  const errors: string[] = [];

  let state: ReplicateState;
  try {
    state = loadReplicateState(outputDir);
  } catch (e) {
    return ctx.errorResult(`Failed to load replicate-state.json: ${(e as Error).message}`);
  }

  // ---- archetype delta ---------------------------------------------------
  const templated = new Set(Object.keys(state.archetypeTemplateMap));
  const newArchetypes = state.archetypesObserved.filter((a) => !templated.has(a));

  const judgmentNeeded: JudgmentNeeded[] = newArchetypes.map((archetype) => ({
    kind: 'archetype-template' as const,
    archetype,
    rationale: `Archetype "${archetype}" has been observed but no templates / patterns are recorded for it. Run the replicate skill to generate the theme files.`,
    inputs: {
      outputDir,
      archetype,
      tickReason: 'new-archetype',
      urlsSeen: state.urlsSeen,
    },
  }));

  // ---- foundation drift --------------------------------------------------
  let driftedFoundation = false;
  try {
    const palettePath = join(outputDir, 'palette.json');
    const typographyPath = join(outputDir, 'typography.json');
    const breakpointsPath = join(outputDir, 'breakpoints.json');
    if (
      existsSync(palettePath) &&
      existsSync(typographyPath) &&
      existsSync(breakpointsPath)
    ) {
      const palette = JSON.parse(readFileSync(palettePath, 'utf8')) as unknown;
      const typography = JSON.parse(readFileSync(typographyPath, 'utf8')) as unknown;
      const breakpoints = JSON.parse(readFileSync(breakpointsPath, 'utf8')) as unknown;
      const computedStylesPath = join(outputDir, 'computed-styles.json');
      const computedStyles = existsSync(computedStylesPath)
        ? JSON.parse(readFileSync(computedStylesPath, 'utf8')) as unknown
        : undefined;
      const score = driftScore(state.lastFoundationInputsDigest, {
        palette,
        typography,
        breakpoints,
        computedStyles,
      });
      if (score > 1) {
        driftedFoundation = true;
        const inputsDigest = computeInputsDigest(palette, typography, breakpoints, computedStyles);
        judgmentNeeded.push({
          kind: 'foundation-rev',
          rationale:
            state.lastFoundationInputsDigest === ''
              ? 'No foundation inputs digest recorded yet; run the design-foundation skill.'
              : 'Foundation inputs have drifted beyond threshold; re-run the design-foundation skill.',
          inputs: {
            outputDir,
            tickReason: 'foundation-drift',
            urlsSeen: state.urlsSeen,
            currentInputsDigest: inputsDigest,
            previousInputsDigest: state.lastFoundationInputsDigest,
          },
        });
      }
    }
  } catch (e) {
    errors.push(`foundation-drift check failed: ${(e as Error).message}`);
  }

  // ---- pick a tickReason for the response + state update -----------------
  const tickReason: string | null =
    newArchetypes.length > 0
      ? 'new-archetype'
      : driftedFoundation
        ? 'foundation-drift'
        : judgmentNeeded.length > 0
          ? 'manual'
          : null;

  // Persist lastTickAt / lastTickReason so the next caller (and the watch
  // CLI's status renderer) can see when the most recent tick happened.
  try {
    const updated: ReplicateState = {
      ...state,
      lastTickAt: new Date().toISOString(),
      lastTickReason: tickReason,
    };
    saveReplicateState(outputDir, updated);
  } catch (e) {
    errors.push(`failed to persist tick state: ${(e as Error).message}`);
  }

  const response: TickResponse = {
    ok: errors.length === 0,
    tickReason,
    newArchetypes,
    judgmentNeeded,
    appliedDeltas: [],
    errors,
  };

  console.error(
    `[replicate] ${JSON.stringify({
      tool: 'tick',
      outputDir,
      ok: response.ok,
      tickReason,
      newArchetypes: newArchetypes.length,
      judgmentNeeded: judgmentNeeded.length,
      durationMs: Date.now() - start,
    })}`,
  );

  return ctx.textResult(response);
};
