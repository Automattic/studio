import path from 'path';
import { createBlockSettingsNotes } from 'cli/ai/block-settings';
import { createSavedCopyNotes } from 'cli/ai/saved-copies';

// A tool call as the notes see it: its arguments and its result's text.
export interface NotedCall {
	args: unknown;
	result: string;
}

// The notes Studio adds to a tool result: facts read from a local site about
// what the call touches, each stated once per tracker. Every surface that runs
// Studio's tools adds them, so a new kind of note is added here and reaches
// all of them.
export function createResultNotes(): ( sitePath: string, call: NotedCall ) => Promise< string > {
	const trackers = new Map< string, Array< ( call: NotedCall ) => string | Promise< string > > >();
	return async ( sitePath, call ) => {
		let notes = trackers.get( sitePath );
		if ( ! notes ) {
			const blockSettings = createBlockSettingsNotes(
				path.join( sitePath, 'wp-includes', 'blocks' )
			);
			const savedCopies = createSavedCopyNotes( sitePath );
			notes = [
				// The blocks a result shows.
				( { result } ) => blockSettings( result ),
				// The theme files a call names, in its arguments or its result.
				( { args, result } ) => savedCopies( `${ JSON.stringify( args ) }\n${ result }` ),
			];
			trackers.set( sitePath, notes );
		}
		const stated = await Promise.all( notes.map( ( note ) => note( call ) ) );
		return stated.filter( Boolean ).join( '\n' );
	};
}
