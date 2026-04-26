import fs from 'fs/promises';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

/**
 * Sidecar transcript persistence for the unified pi runtime.
 *
 * pi-agent-core has no built-in cross-fork persistence — its `Agent`
 * transcript only lives in memory. The desktop UI forks a fresh CLI per turn
 * (apps/studio/src/modules/ai-agent/run-manager.ts), so without persistence
 * the agent loses every prior turn between forks.
 *
 * We sidecar pi's native `AgentMessage[]` next to the JSONL Studio already
 * writes. Same directory, same lifetime as the JSONL, but a separate file
 * so the desktop UI's display layer (which reads only the JSONL) never has
 * to know pi's shape. Lossless on the runtime side because we serialize the
 * exact array pi handed us — no inverse-of-translateEvent gymnastics.
 *
 * The sidecar is best-effort: a missing or malformed file just starts the
 * Agent fresh. The recorder JSONL remains the source of truth for *display*;
 * this file is the source of truth for *agent memory*.
 */

const SIDECAR_SUFFIX = '.pi-state.json';
// Pre-rename suffix used while the runtime was OpenAI-only. Read-only fallback
// so existing sessions don't lose their pi-side memory across the migration.
const LEGACY_SIDECAR_SUFFIX = '.openai-state.json';

/**
 * Convert a session JSONL path to its sidecar path.
 *   .../2026-04-24T18-57-34-<uuid>.jsonl
 *   → .../2026-04-24T18-57-34-<uuid>.pi-state.json
 *
 * Sidecars sit next to the JSONL so cleanup paths that walk the directory
 * (delete-session, prune-empty-directory) handle both as siblings.
 */
export function getSidecarPath( sessionFilePath: string ): string {
	if ( sessionFilePath.endsWith( '.jsonl' ) ) {
		return sessionFilePath.slice( 0, -'.jsonl'.length ) + SIDECAR_SUFFIX;
	}
	return sessionFilePath + SIDECAR_SUFFIX;
}

function getLegacySidecarPath( sessionFilePath: string ): string {
	if ( sessionFilePath.endsWith( '.jsonl' ) ) {
		return sessionFilePath.slice( 0, -'.jsonl'.length ) + LEGACY_SIDECAR_SUFFIX;
	}
	return sessionFilePath + LEGACY_SIDECAR_SUFFIX;
}

async function readSidecarFile( filePath: string ): Promise< AgentMessage[] | null > {
	try {
		const data = await fs.readFile( filePath, 'utf8' );
		const parsed: unknown = JSON.parse( data );
		if ( ! Array.isArray( parsed ) ) {
			return null;
		}
		return parsed as AgentMessage[];
	} catch ( error ) {
		const fsError = error as NodeJS.ErrnoException;
		if ( fsError.code === 'ENOENT' ) {
			// Fresh session, never persisted — totally normal on first turn.
			return null;
		}
		// Malformed JSON or read error: treat as missing, don't crash the run.
		return null;
	}
}

export async function loadSidecar( sessionFilePath: string ): Promise< AgentMessage[] | null > {
	const primary = await readSidecarFile( getSidecarPath( sessionFilePath ) );
	if ( primary !== null ) {
		return primary;
	}
	// Pre-migration sessions persisted under the OpenAI-specific suffix. Read
	// it as a one-time fallback so resumed sessions don't forget their state.
	// We never write this path back — `saveSidecar` always uses the new name.
	return readSidecarFile( getLegacySidecarPath( sessionFilePath ) );
}

/**
 * Atomically write the sidecar so a crash mid-write doesn't leave a truncated
 * file the next process tries to parse.
 */
export async function saveSidecar(
	sessionFilePath: string,
	messages: AgentMessage[]
): Promise< void > {
	const path = getSidecarPath( sessionFilePath );
	const tmp = `${ path }.tmp`;
	const serialized = JSON.stringify( messages );
	await fs.writeFile( tmp, serialized, 'utf8' );
	await fs.rename( tmp, path );
}

/**
 * Best-effort cleanup. Called from `deleteAiSession` so the sidecar dies with
 * its JSONL. Missing file is fine; any other error is swallowed because we
 * don't want a stale sidecar to block deletion of the real session file.
 *
 * Sweeps both the current and legacy suffixes so the function works regardless
 * of which runtime version wrote the sidecar.
 */
export async function deleteSidecar( sessionFilePath: string ): Promise< void > {
	for ( const candidate of [
		getSidecarPath( sessionFilePath ),
		getLegacySidecarPath( sessionFilePath ),
	] ) {
		try {
			await fs.unlink( candidate );
		} catch {
			// ENOENT or permission errors — sidecar is opportunistic, not load-bearing.
		}
	}
}
