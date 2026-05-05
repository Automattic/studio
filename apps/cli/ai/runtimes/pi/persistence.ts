import fs from 'fs/promises';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

// pi-agent-core's `Agent` transcript only lives in memory; the desktop UI
// forks a fresh CLI per turn, so without persistence the agent loses prior
// turns between forks. We sidecar pi's `AgentMessage[]` next to the JSONL
// Studio already writes for display.

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
	} catch {
		// Missing, malformed, or unreadable — start fresh.
		return null;
	}
}

// Atomic write so a crash mid-write doesn't leave a truncated file.
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

export async function deleteSidecar( sessionFilePath: string ): Promise< void > {
	const path = getSidecarPath( sessionFilePath );
	try {
		await fs.unlink( path );
	} catch {
		// Best-effort — missing sidecar must not block JSONL deletion.
	}
}
