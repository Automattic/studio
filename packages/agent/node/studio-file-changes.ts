/**
 * The changes Studio makes to a site's files itself, as a fix it saves, so a
 * check of what a call changed can tell them from the call's own: the same
 * file, from the version Studio found to the version it left.
 */
import { realpathSync } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';

// By file: the version Studio's changes started from and the one they left.
const changes = new Map< string, { from: string; to: string } >();

// One file, however it is named, as /var and /private/var on macOS.
function key( file: string ): string {
	try {
		return realpathSync.native( file );
	} catch {
		return path.resolve( file );
	}
}

/** A file's version: its modification time and size, or '' where there is none. */
export async function fileVersion( file: string ): Promise< string > {
	const stats = await stat( file ).catch( () => undefined );
	return stats ? `${ stats.mtimeMs }:${ stats.size }` : '';
}

/** Runs `change`, which Studio makes to `file`, and records the versions it took the file between. */
export async function studioChange< T >( file: string, change: () => Promise< T > ): Promise< T > {
	const from = await fileVersion( file );
	const result = await change();
	const to = await fileVersion( file );
	if ( from !== to ) {
		const was = changes.get( key( file ) );
		// Changes Studio makes one after another are one change.
		changes.set( key( file ), { from: was?.to === from ? was.from : from, to } );
	}
	return result;
}

/** Whether Studio alone took `file` from version `from` to version `to`. */
export function changedByStudio( file: string, from: string, to: string ): boolean {
	const change = changes.get( key( file ) );
	return change?.from === from && change.to === to;
}
