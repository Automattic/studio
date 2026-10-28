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
import fs from 'fs';
import path from 'path';
import { createBlockExampleNotes } from 'cli/ai/block-examples';
import { createBlockSettingsNotes } from 'cli/ai/block-settings';
import { rewriteNotes } from 'cli/ai/file-rewrites';
import { repeatedStyleValueNotes } from 'cli/ai/repeated-style-values';
import { createSharedBlockClassNotes } from 'cli/ai/shared-block-classes';
import { readSiteFacts } from 'cli/ai/site-facts';
import {
	blockMarkupNotes,
	clearThemePatternCache,
	externalImageNotes,
	freeFullWidthBlocks,
	frontPageTemplateNotes,
	getSiteFileWriteRefusal,
	partInTemplatesRefusal,
	phpInBlockTemplateRefusal,
	resolveSiteFile,
	savedCopyNotes,
	selfHostFonts,
	themeCssNotes,
	themeJsonNotes,
	writeThemeThumbnail,
	type SiteFile,
} from 'cli/ai/site-file-guards';
import { themeJsonFileNotes } from 'cli/ai/theme-json-files';
import { keepThemePresets } from 'cli/ai/theme-presets';
import type { BlockValidationGate } from 'cli/ai/block-validation-gate';

type Notes = string[] | Promise< string[] >;

interface Sources {
	beforeWrite: Array< ( file: SiteFile, text: string ) => Notes >;
	write: Array< ( file: SiteFile ) => Notes >;
	result: Array< ( sitePath: string, text: string ) => Notes >;
}

interface SiteNotesOptions {
	/** The facts the agent already has, by site path. */
	stated?: Map< string, string[][] >;
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
// soon mode, is known at once. A fact that now reads otherwise is stated as
// it reads; one that now states nothing is stated as no longer true. A site
// without stated facts gets its facts with its first result.
function siteFactsSource( stated: Map< string, string[][] > ): Sources[ 'result' ][ number ] {
	return async ( sitePath ) => {
		const facts = await readSiteFacts( sitePath );
		// A site's path, as the config and the request name it, is one key.
		const key = path.resolve( sitePath );
		const before = stated.get( key ) ?? [];
		stated.set( key, facts );
		const added = facts.map( ( lines, i ) =>
			lines.filter( ( line ) => ! before[ i ]?.includes( line ) )
		);
		const ended = before.map( ( lines, i ) =>
			facts[ i ]?.length ? [] : lines.map( ( line ) => `No longer true: ${ line }` )
		);
		return [ ...added.flat(), ...ended.flat() ];
	};
}

function sources( { stated = new Map(), gate }: SiteNotesOptions ): Sources {
	return {
		beforeWrite: [
			async ( file ) => {
				const refusal = await getSiteFileWriteRefusal( file );
				return refusal ? [ refusal ] : [];
			},
			( file, text ) =>
				[ phpInBlockTemplateRefusal( file, text ), partInTemplatesRefusal( file ) ].filter(
					Boolean
				) as string[],
		],
		write: [
			// Before the gate reads the file and the theme's presets for its save.
			freeFullWidthBlocks,
			( file ) => repeatedStyleValueNotes( file, { gateSaves: Boolean( gate ) } ),
			( { siteRoot, relativePath } ) => {
				gate?.track( path.join( siteRoot, relativePath ), siteRoot );
				return [];
			},
			clearThemePatternCache,
			selfHostFonts,
			writeThemeThumbnail,
			blockMarkupNotes,
			themeJsonNotes,
			themeJsonFileNotes,
			keepThemePresets,
			themeCssNotes,
			createSharedBlockClassNotes(),
			externalImageNotes,
			savedCopyNotes,
			frontPageTemplateNotes,
		],
		result: [ blockSettingsSource(), createBlockExampleNotes(), siteFactsSource( stated ) ],
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

function realPath( filePath: string ): string {
	try {
		return fs.realpathSync( filePath );
	} catch {
		return filePath;
	}
}

function readText( filePath: string ): string | undefined {
	try {
		return fs.readFileSync( filePath, 'utf8' );
	} catch {
		return undefined;
	}
}

export interface SiteNotes {
	/** Why a write of this text to this file must not happen, or undefined. */
	beforeWrite( filePath: string, text?: string ): Promise< string | undefined >;
	/**
	 * The notes on a write to this file, and what Studio changed in it since
	 * the tool left `written`, or since this call when that is not known.
	 */
	afterWrite( filePath: string, written?: string ): Promise< string[] >;
	/** The notes on a Studio tool's result about this site. */
	afterResult( sitePath: string, text: string ): Promise< string[] >;
}

/** One agent session's notes: sources that say a thing once keep that here. */
export function createSiteNotes( options: SiteNotesOptions = {} ): SiteNotes {
	const { beforeWrite, write, result } = sources( options );
	// The notes each file's last write gave, by file: a note said once while
	// it stands, and again should it come back after a write that gave none.
	const standing = new Map< string, string[] >();
	const once = ( file: string, notes: string[] ) => {
		const said = standing.get( file ) ?? [];
		standing.set( file, notes );
		return notes.filter( ( note ) => ! said.includes( note ) );
	};
	return {
		async beforeWrite( filePath, text = '' ) {
			// Unlike a note, a refusal that fails stops the write.
			const file = resolveSiteFile( filePath );
			const refusals = file
				? ( await Promise.all( beforeWrite.map( ( source ) => source( file, text ) ) ) ).flat()
				: [];
			return refusals.length ? `Not run: ${ refusals.join( ' ' ) }` : undefined;
		},
		async afterWrite( filePath, written = readText( filePath ) ) {
			const file = resolveSiteFile( filePath );
			if ( ! file ) {
				return [];
			}
			const notes = once(
				// One file, however the call names it, as /var and /private/var on macOS.
				realPath( filePath ),
				await collect( write.map( ( source ) => () => source( file ) ) )
			);
			const now = readText( filePath );
			return written === undefined || now === undefined
				? notes
				: [ ...notes, ...rewriteNotes( filePath, written, now ) ];
		},
		async afterResult( sitePath, text ) {
			return collect( result.map( ( source ) => () => source( sitePath, text ) ) );
		},
	};
}
