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
async function changedSince( dir: string, since: number ): Promise< boolean > {
	let entries;
	try {
		entries = await readdir( dir, { withFileTypes: true } );
	} catch {
		return false;
	}
	for ( const entry of entries ) {
		const entryPath = path.join( dir, entry.name );
		if ( entry.isDirectory() ) {
			if ( await changedSince( entryPath, since ) ) return true;
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

// The files a turn's tool calls name in a `path` argument, resolved the way
// the file tools resolve them.
function pathsNamedInTurn(
	event: Extract< AgentSessionEvent, { type: 'turn_end' } >,
	cwd: string
) {
	const content = event.message.role === 'assistant' ? event.message.content : [];
	const succeeded = new Set(
		event.toolResults
			.filter( ( result ) => ! result.isError )
			.map( ( result ) => result.toolCallId )
	);
	return content.flatMap( ( part ) => {
		if ( part.type !== 'toolCall' || ! succeeded.has( part.id ) ) return [];
		const named = part.arguments?.path;
		if ( typeof named !== 'string' || ! named ) return [];
		const expanded = named.startsWith( '~/' ) ? path.join( os.homedir(), named.slice( 2 ) ) : named;
		return [ path.resolve( cwd, expanded ) ];
	} );
}

interface PreviewReloaderOptions {
	// The local site the preview shows, if any.
	getSitePath: () => string | undefined;
	// The directory the file tools resolve relative paths against.
	cwd: string;
	reload: () => void;
}

// Reloads the Studio preview when the site it shows changed:
// - at the end of a turn whose tool calls changed a file in wp-content, so a
//   build shows its theme and styles as they land;
// - when the agent finishes the request, if anything else in wp-content
//   changed since the last reload: `wp` commands, Bash, the database.
// WordPress also writes to the database in the background (WP-Cron, editor
// autosaves), so that catch-all runs once per request, not per turn.
export function createPreviewReloader( { getSitePath, cwd, reload }: PreviewReloaderOptions ) {
	const startPath = getSitePath();
	let lastReload = Date.now();

	const reloadNow = () => {
		lastReload = Date.now();
		reload();
	};

	return ( event: AgentSessionEvent ): void => {
		const sitePath = getSitePath();
		if ( event.type === 'turn_end' && sitePath ) {
			const wpContent = wpContentOf( sitePath ) + path.sep;
			const changedFile = pathsNamedInTurn( event, cwd ).some(
				( file ) => file.startsWith( wpContent ) && modifiedAt( file ) > lastReload
			);
			if ( changedFile ) reloadNow();
			return;
		}
		// An `agent_end` that will retry is not the end of the request.
		if ( event.type !== 'agent_end' || event.willRetry || ! sitePath ) return;
		// A site the agent made active during the request is new to the preview.
		if ( sitePath !== startPath ) {
			reloadNow();
			return;
		}
		const since = lastReload;
		void changedSince( wpContentOf( sitePath ), since ).then( ( changed ) => {
			if ( changed && lastReload === since ) reloadNow();
		} );
	};
}
