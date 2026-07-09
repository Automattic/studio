import { IpcMainInvokeEvent } from 'electron';
import { readAiSessionPlacements } from '@studio/common/ai/sessions/placement';
import { listActiveAgentRuns } from 'src/modules/ai-agent/run-manager';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { SiteServer } from 'src/site-server';

// One entry of a site's checkpoint index, as reported by the CLI's
// `checkpoint list --json` (mirrors the engine's `CheckpointIndexEntry`).
// `createdAt` is epoch milliseconds.
export interface SiteCheckpointEntry {
	id: string;
	label?: string;
	createdAt: number;
	trigger: 'manual' | 'agent' | 'auto-pre-tool' | 'pre-restore';
	toolName?: string;
	pinned?: boolean;
	stats: {
		fileCount: number;
		logicalBytes: number;
		newObjectBytes: number;
	};
}

function getSitePath( siteId: string ): string {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	return site.details.path;
}

// Forks the same `studio checkpoint` CLI command the terminal user runs and
// resolves with the captured stdout (used by `list --json`; mutations ignore it).
function runCheckpointCliCommand( args: string[] ): Promise< string > {
	return new Promise< string >( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand( args, { output: 'capture' } );
		emitter.on( 'success', ( { result } ) => resolve( result.stdout ) );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}

export async function listSiteCheckpoints(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< SiteCheckpointEntry[] > {
	const sitePath = getSitePath( siteId );
	const stdout = await runCheckpointCliCommand( [
		'checkpoint',
		'list',
		'--path',
		sitePath,
		'--json',
	] );
	// `checkpoint list --json` prints a single JSON object on stdout:
	// `{ checkpoints: [...], interruptedRestore: ... }`. Parse from the first
	// `{` so any stray CLI output before it can't break the parse.
	const jsonStart = stdout.indexOf( '{' );
	const parsed = JSON.parse( jsonStart >= 0 ? stdout.slice( jsonStart ) : stdout ) as {
		checkpoints?: SiteCheckpointEntry[];
	};
	return parsed.checkpoints ?? [];
}

export async function createSiteCheckpoint(
	_event: IpcMainInvokeEvent,
	siteId: string,
	label?: string
): Promise< void > {
	const sitePath = getSitePath( siteId );
	const args = [ 'checkpoint', 'create', '--path', sitePath ];
	const trimmedLabel = label?.trim();
	if ( trimmedLabel ) {
		args.push( '--label', trimmedLabel );
	}
	await runCheckpointCliCommand( args );
}

export async function restoreSiteCheckpoint(
	_event: IpcMainInvokeEvent,
	siteId: string,
	checkpointId: string
): Promise< void > {
	const sitePath = getSitePath( siteId );
	// Refuse to rewrite the site tree under an agent that is actively working
	// on it — restoring mid-run would yank files out from under the run's
	// tools. Active runs are matched to the site through their session
	// placement.
	const activeRuns = listActiveAgentRuns();
	if ( activeRuns.length > 0 ) {
		const placements = await readAiSessionPlacements();
		const busy = activeRuns.some( ( run ) => placements[ run.sessionId ]?.siteId === siteId );
		if ( busy ) {
			throw new Error(
				'An agent is currently working on this site. Stop the run before restoring.'
			);
		}
	}
	// The CLI restore stops the site server, applies files + database, and
	// restarts it — plus captures a safety checkpoint of the current state
	// first, so the restore itself is undoable.
	await runCheckpointCliCommand( [
		'checkpoint',
		'restore',
		checkpointId,
		'--path',
		sitePath,
		'--yes',
	] );
}

export async function deleteSiteCheckpoint(
	_event: IpcMainInvokeEvent,
	siteId: string,
	checkpointId: string
): Promise< void > {
	const sitePath = getSitePath( siteId );
	await runCheckpointCliCommand( [ 'checkpoint', 'delete', checkpointId, '--path', sitePath ] );
}
