import { createBlockSettingsNotes } from './block-settings';
import type { StudioAgentHost } from '@studio/agent/node/host';

// The notes Studio adds to a tool result: facts read from a local site about
// what the result shows, each stated once per tracker. Every surface that runs
// Studio's tools adds them, so a new kind of note is added here and reaches
// all of them.
export function createResultNotes(
	host: StudioAgentHost
): ( sitePath: string, text: string ) => Promise< string > {
	const trackers = new Map< string, Array< ( text: string ) => string | Promise< string > > >();
	return async ( sitePath, text ) => {
		let notes = trackers.get( sitePath );
		if ( ! notes ) {
			notes = [
				createBlockSettingsNotes( host, host.path.join( sitePath, 'wp-includes', 'blocks' ) ),
			];
			trackers.set( sitePath, notes );
		}
		const stated = await Promise.all( notes.map( ( note ) => note( text ) ) );
		return stated.filter( Boolean ).join( '\n' );
	};
}
