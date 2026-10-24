import path from 'path';
import { createBlockSettingsNotes } from 'cli/ai/block-settings';
import { readSiteFacts } from 'cli/ai/site-facts';

// The notes Studio adds to a tool result about a local site. Every surface
// that runs Studio's tools adds them, so a new kind of note is added here and
// reaches all of them:
//
// - The settings of the core blocks a result shows, once each.
// - The site's facts (site-facts.ts) the agent does not have yet, and the ones
//   that stopped being true, so a change a call makes, such as a plugin
//   turning on Coming soon mode, is known at once. `stated` holds the facts the
//   agent already has, by site path; a site without them gets its facts with
//   its first result.
export function createResultNotes(
	stated: Map< string, string[] > = new Map()
): ( sitePath: string, result: string ) => Promise< string > {
	const blockSettingsBySite = new Map< string, ( result: string ) => string >();
	return async ( sitePath, result ) => {
		let blockSettings = blockSettingsBySite.get( sitePath );
		if ( ! blockSettings ) {
			blockSettings = createBlockSettingsNotes( path.join( sitePath, 'wp-includes', 'blocks' ) );
			blockSettingsBySite.set( sitePath, blockSettings );
		}
		const facts = await readSiteFacts( sitePath );
		const before = stated.get( sitePath ) ?? [];
		stated.set( sitePath, facts );
		return [
			blockSettings( result ),
			...facts.filter( ( fact ) => ! before.includes( fact ) ),
			...before
				.filter( ( fact ) => ! facts.includes( fact ) )
				.map( ( fact ) => `No longer true: ${ fact }` ),
		]
			.filter( Boolean )
			.join( '\n' );
	};
}
