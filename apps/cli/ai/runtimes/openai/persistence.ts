import fs from 'fs/promises';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

/**
 * Sidecar transcript persistence for the OpenAI runtime.
 *
 * The Claude Agent SDK ships its own on-disk session store, so cross-fork
 * resume works for free. pi-agent-core has no equivalent — its `Agent`
 * transcript only lives in memory. The desktop UI forks a fresh CLI per turn
 * (apps/studio/src/modules/ai-agent/run-manager.ts), so without persistence
 * GPT loses every prior turn between forks.
 *
 * We sidecar pi's native `AgentMessage[]` next to the JSONL Studio already
 * writes. Same directory, same lifetime as the JSONL, but a separate file
 * so the desktop UI's display layer (which reads only the JSONL) never has
 * to know pi's shape. Lossless on the runtime side because we serialize the
 * exact array pi handed us — no inverse-of-translateEvent gymnastics.
 *
 * The sidecar is best-effort: a missing or malformed file just starts the
 * Agent fresh. The recorder JSONL remains the source of truth for *display*;
 * this file is the source of truth for *agent memory* on the OpenAI side.
 */

/**
 * Convert a session JSONL path to its sidecar path.
 *   .../2026-04-24T18-57-34-<uuid>.jsonl
 *   → .../2026-04-24T18-57-34-<uuid>.openai-state.json
 *
 * Sidecars sit next to the JSONL so cleanup paths that walk the directory
 * (delete-session, prune-empty-directory) handle both as siblings.
 */
export function getSidecarPath( sessionFilePath: string ): string {
	if ( sessionFilePath.endsWith( '.jsonl' ) ) {
		return sessionFilePath.slice( 0, -'.jsonl'.length ) + '.openai-state.json';
	}
	return sessionFilePath + '.openai-state.json';
}

export async function loadSidecar( sessionFilePath: string ): Promise< AgentMessage[] | null > {
	const path = getSidecarPath( sessionFilePath );
	try {
		const data = await fs.readFile( path, 'utf8' );
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
 */
export async function deleteSidecar( sessionFilePath: string ): Promise< void > {
	const path = getSidecarPath( sessionFilePath );
	try {
		await fs.unlink( path );
	} catch {
		// ENOENT or permission errors — sidecar is opportunistic, not load-bearing.
	}
}
