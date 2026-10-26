/**
 * What Studio tells the agent about a local WordPress site, at the moment an
 * action makes it true, instead of prose the agent has to remember.
 *
 * Each source runs on one trigger:
 *
 * - `beforeWrite`: a file tool is about to write a site's file. A note here
 *   refuses the write, and says where the change belongs.
 * - `write`: a file tool, or any call (site-file-writes.ts), wrote a site's
 *   file. Sources may act on the file (self-host its fonts, give its theme a
 *   thumbnail) and say what they did, or say what WordPress will render
 *   differently from it.
 * - `result`: one of Studio's tools returned a result about a site.
 *
 * A new note is one more source in SOURCES, and reaches every surface that
 * fires its trigger: Studio Code fires all three; `studio mcp`, which Claude
 * Code and Codex use, fires `result`.
 */
import path from 'path';
import { createBlockSettingsNotes } from 'cli/ai/block-settings';
import { readSiteFacts } from 'cli/ai/site-facts';
import {
	blockMarkupNotes,
	clearThemePatternCache,
	externalImageNotes,
	frontPageTemplateNotes,
	getSiteFileWriteRefusal,
	resolveSiteFile,
	savedCopyNotes,
	selfHostFonts,
	themeCssNotes,
	themeJsonNotes,
	writeThemeThumbnail,
	type SiteFile,
} from 'cli/ai/site-file-guards';
import { repeatedStyleValueNotes } from 'cli/ai/repeated-style-values';
import { createSharedBlockClassNotes } from 'cli/ai/shared-block-classes';
import { themeJsonFileNotes } from 'cli/ai/theme-json-files';
import { shadowedPresetNotes } from 'cli/ai/theme-presets';
import type { BlockValidationGate } from 'cli/ai/block-validation-gate';

type Notes = string[] | Promise< string[] >;

interface Sources {
	beforeWrite: Array< ( file: SiteFile ) => Notes >;
	write: Array< ( file: SiteFile ) => Notes >;
	result: Array< ( sitePath: string, text: string ) => Notes >;
}

interface SiteNotesOptions {
	/** The facts the agent already has, by site path. */
	stated?: Map< string, string[] >;
	/** Validates the block markup a write leaves, for the surface to report. */
	gate?: BlockValidationGate;
}

// The settings of the core blocks a result shows, once each per site.
function blockSettingsSource(): Sources[ 'result' ][ number ] {
	const bySite = new Map< string, ( text: string ) => string >();
	return ( sitePath, text ) => {
		let describe = bySite.get( sitePath );
		if ( ! describe ) {
			describe = createBlockSettingsNotes( path.join( sitePath, 'wp-includes', 'blocks' ) );
			bySite.set( sitePath, describe );
		}
		return [ describe( text ) ].filter( Boolean );
	};
}

// The site's facts the agent does not have yet, and the ones that stopped
// being true, so a change a call makes, such as a plugin turning on Coming
// soon mode, is known at once. A site without stated facts gets its facts
// with its first result.
function siteFactsSource( stated: Map< string, string[] > ): Sources[ 'result' ][ number ] {
	return async ( sitePath ) => {
		const facts = await readSiteFacts( sitePath );
		const before = stated.get( sitePath ) ?? [];
		stated.set( sitePath, facts );
		return [
			...facts.filter( ( fact ) => ! before.includes( fact ) ),
			...before
				.filter( ( fact ) => ! facts.includes( fact ) )
				.map( ( fact ) => `No longer true: ${ fact }` ),
		];
	};
}

function sources( { stated = new Map(), gate }: SiteNotesOptions ): Sources {
	return {
		beforeWrite: [
			async ( file ) => {
				const refusal = await getSiteFileWriteRefusal( file );
				return refusal ? [ refusal ] : [];
			},
		],
		write: [
			( { siteRoot, relativePath } ) => {
				gate?.track( path.join( siteRoot, relativePath ), siteRoot );
				return [];
			},
			clearThemePatternCache,
			selfHostFonts,
			writeThemeThumbnail,
			blockMarkupNotes,
			repeatedStyleValueNotes,
			themeJsonNotes,
			themeJsonFileNotes,
			shadowedPresetNotes,
			themeCssNotes,
			createSharedBlockClassNotes(),
			externalImageNotes,
			savedCopyNotes,
			frontPageTemplateNotes,
		],
		result: [ blockSettingsSource(), siteFactsSource( stated ) ],
	};
}

// A source that fails says nothing, so the action it follows stands.
async function collect( notes: Array< () => Notes > ): Promise< string[] > {
	const lines: string[] = [];
	for ( const note of notes ) {
		lines.push(
			...( await Promise.resolve()
				.then( note )
				.catch( () => [] ) )
		);
	}
	return lines;
}

export interface SiteNotes {
	/** Why a write to this file must not happen, or undefined. */
	beforeWrite( filePath: string ): Promise< string | undefined >;
	/** The notes on a write to this file. */
	afterWrite( filePath: string ): Promise< string[] >;
	/** The notes on a Studio tool's result about this site. */
	afterResult( sitePath: string, text: string ): Promise< string[] >;
}

/** One agent session's notes: sources that say a thing once keep that here. */
export function createSiteNotes( options: SiteNotesOptions = {} ): SiteNotes {
	const { beforeWrite, write, result } = sources( options );
	return {
		async beforeWrite( filePath ) {
			// Unlike a note, a refusal that fails stops the write.
			const file = resolveSiteFile( filePath );
			const refusals = file
				? ( await Promise.all( beforeWrite.map( ( source ) => source( file ) ) ) ).flat()
				: [];
			return refusals.length ? `Not run: ${ refusals.join( ' ' ) }` : undefined;
		},
		async afterWrite( filePath ) {
			const file = resolveSiteFile( filePath );
			return file ? await collect( write.map( ( source ) => () => source( file ) ) ) : [];
		},
		async afterResult( sitePath, text ) {
			return collect( result.map( ( source ) => () => source( sitePath, text ) ) );
		},
	};
}
