import fs from 'fs/promises';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';

// Where a running `studio ui` records its URL, so other Studio processes (the
// MCP server) can reuse it instead of starting a second one.
export interface UiServerState {
	pid: number;
	url: string;
}

function getUiServerStatePath(): string {
	return path.join( getConfigDirectory(), 'ui-server.json' );
}

export async function writeUiServerState( state: UiServerState ): Promise< void > {
	await fs.mkdir( getConfigDirectory(), { recursive: true } );
	await fs.writeFile( getUiServerStatePath(), JSON.stringify( state ) );
}

export async function clearUiServerState( pid: number ): Promise< void > {
	const state = await readUiServerState();
	if ( state?.pid === pid ) {
		await fs.rm( getUiServerStatePath(), { force: true } );
	}
}

export async function readUiServerState(): Promise< UiServerState | null > {
	try {
		const state = JSON.parse( await fs.readFile( getUiServerStatePath(), 'utf-8' ) );
		return typeof state?.pid === 'number' && typeof state?.url === 'string' ? state : null;
	} catch {
		return null;
	}
}
