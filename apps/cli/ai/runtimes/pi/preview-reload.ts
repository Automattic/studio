import { statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// Everything a local site renders comes from wp-content: themes, plugins,
// uploads, and the SQLite database. Core files are not the agent's to change.
function wpContentOf( sitePath: string ): string {
	return path.join( sitePath, 'wp-content' );
}

// In whole milliseconds, like Date.now(): file times are finer, and a file
// written in the same millisecond as a reload must not look newer than it.
function modifiedAt( file: string ): number {
	try {
		return Math.floor( statSync( file ).mtimeMs );
	} catch {
		return 0;
	}
}

// Whether anything under `dir` changed after `since`. Asynchronous so a large
// site never stalls the CLI, and it stops at the first changed file.
async function changedSince( dir: string, since: number, skip?: string ): Promise< boolean > {
	let entries;
	try {
		entries = await readdir( dir, { withFileTypes: true } );
	} catch {
		return false;
	}
	for ( const entry of entries ) {
		const entryPath = path.join( dir, entry.name );
		if ( entryPath === skip ) continue;
		if ( entry.isDirectory() ) {
			if ( await changedSince( entryPath, since, skip ) ) return true;
		} else if ( entry.isFile() ) {
			try {
				if ( Math.floor( ( await stat( entryPath ) ).mtimeMs ) > since ) return true;
			} catch {
				// Removed while scanning.
			}
		}
	}
	return false;
}

type TurnEnd = Extract< AgentSessionEvent, { type: 'turn_end' } >;

// The tool calls of a turn that succeeded.
function succeededCalls( event: TurnEnd ) {
	const content = event.message.role === 'assistant' ? event.message.content : [];
	const succeeded = new Set(
		event.toolResults
			.filter( ( result ) => ! result.isError )
			.map( ( result ) => result.toolCallId )
	);
	return content.flatMap( ( part ) =>
		part.type === 'toolCall' && succeeded.has( part.id ) ? [ part ] : []
	);
}

// A file a tool call names in its `path` argument, resolved the way the file
// tools resolve it.
function namedPath( args: Record< string, unknown > | undefined, cwd: string ) {
	const named = args?.path;
	if ( typeof named !== 'string' || ! named ) return undefined;
	const expanded = named.startsWith( '~/' ) ? path.join( os.homedir(), named.slice( 2 ) ) : named;
	return path.resolve( cwd, expanded );
}

interface PreviewReloaderOptions {
	// The local site the preview shows, if any.
	getSitePath: () => string | undefined;
	// The directory the file tools resolve relative paths against.
	cwd: string;
	// Whether a tool replaces data, from its `destructiveHint` annotation.
	isDestructive: ( toolName: string ) => boolean;
	// `tool`: a tool call changed the site. `request`: the request ended and
	// something in wp-content changed, possibly WordPress itself.
	reload: ( source: 'tool' | 'request' ) => void;
}

// Reloads the Studio preview when the site it shows changed:
// - at the end of a turn whose tool calls changed a file in wp-content, so a
//   build shows its theme and styles as they land;
// - when the agent finishes the request, if anything else in wp-content
//   changed since the last reload, such as files written by `wp` or Bash.
// WordPress writes to its database in the background (WP-Cron, editor post
// locks and autosaves), so the database only counts once the request ran a
// command or a tool that replaces data: the calls that can write it without
// naming a file.
export function createPreviewReloader( {
	getSitePath,
	cwd,
	isDestructive,
	reload,
}: PreviewReloaderOptions ) {
	const startPath = getSitePath();
	let lastReload = Date.now();
	let ranDatabaseWriter = false;

	const reloadNow = ( source: 'tool' | 'request' ) => {
		lastReload = Date.now();
		reload( source );
	};

	return ( event: AgentSessionEvent ): void => {
		const sitePath = getSitePath();
		if ( event.type === 'turn_end' ) {
			const calls = succeededCalls( event );
			ranDatabaseWriter ||= calls.some(
				( call ) => typeof call.arguments?.command === 'string' || isDestructive( call.name )
			);
			if ( ! sitePath ) return;
			const wpContent = wpContentOf( sitePath ) + path.sep;
			const changedFile = calls.some( ( call ) => {
				const file = namedPath( call.arguments, cwd );
				return file?.startsWith( wpContent ) && modifiedAt( file ) > lastReload;
			} );
			if ( changedFile ) reloadNow( 'tool' );
			return;
		}
		// An `agent_end` that will retry is not the end of the request.
		if ( event.type !== 'agent_end' || event.willRetry || ! sitePath ) return;
		// A site the agent made active during the request is new to the preview.
		if ( sitePath !== startPath ) {
			reloadNow( 'tool' );
			return;
		}
		const since = lastReload;
		const database = ranDatabaseWriter
			? undefined
			: path.join( wpContentOf( sitePath ), 'database' );
		void changedSince( wpContentOf( sitePath ), since, database ).then( ( changed ) => {
			if ( changed && lastReload === since ) reloadNow( 'request' );
		} );
	};
}
