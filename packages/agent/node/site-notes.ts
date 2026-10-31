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
import { createBlockExampleNotes } from '@studio/agent/node/block-examples';
import { createBlockSettingsNotes } from '@studio/agent/node/block-settings';
import { rewriteNotes } from '@studio/agent/node/file-rewrites';
import { repeatedStyleValueNotes } from '@studio/agent/node/repeated-style-values';
import { createSharedBlockClassNotes } from '@studio/agent/node/shared-block-classes';
import { readSiteFacts } from '@studio/agent/node/site-facts';
import {
	blockMarkupNotes,
	clearThemePatternCache,
	externalImageNotes,
	freeFullWidthBlocks,
	frontPageTemplateNotes,
	frontPageTemplateRefusal,
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
} from '@studio/agent/node/site-file-guards';
import { themeJsonFileNotes } from '@studio/agent/node/theme-json-files';
import { keepThemePresets } from '@studio/agent/node/theme-presets';
import type { BlockValidationGate } from '@studio/agent/node/block-validation-gate';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { OpenProblems } from '@studio/agent/node/open-problems';

type Notes = string[] | Promise< string[] >;

interface Sources {
	beforeWrite: Array< ( file: SiteFile, text: string ) => Notes >;
	// Named, for the time each takes in a profile.
	write: Record< string, ( file: SiteFile ) => Notes >;
	result: Record< string, ( sitePath: string, text: string ) => Notes >;
}

interface SiteNotesOptions {
	/** The facts the agent already has, by site path. */
	stated?: Map< string, string[][] >;
	/** Validates the block markup a write leaves, for the surface to report. */
	gate?: BlockValidationGate;
	/** The session's open problems, for the ones a write leaves for the turn's end. */
	open?: OpenProblems;
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
function siteFactsSource(
	host: StudioAgentHost,
	stated: Map< string, string[][] >
): Sources[ 'result' ][ number ] {
	return async ( sitePath ) => {
		const facts = await readSiteFacts( host, sitePath );
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

function sources(
	host: StudioAgentHost,
	{ stated = new Map(), gate, open }: SiteNotesOptions
): Sources {
	return {
		beforeWrite: [
			async ( file ) => {
				const refusal = await getSiteFileWriteRefusal( host, file );
				return refusal ? [ refusal ] : [];
			},
			async ( file, text ) =>
				[
					phpInBlockTemplateRefusal( file, text ),
					partInTemplatesRefusal( file ),
					await frontPageTemplateRefusal( file, text ),
				].filter( Boolean ) as string[],
		],
		// In order: each sees the file as the ones before it left it.
		write: {
			// Before the gate reads the file and the theme's presets for its save.
			'full width blocks': freeFullWidthBlocks,
			'repeated style values': ( file ) =>
				repeatedStyleValueNotes( host, file, { gateSaves: Boolean( gate ) } ),
			'block validation': ( { siteRoot, relativePath } ) => {
				gate?.track( path.join( siteRoot, relativePath ), siteRoot );
				return [];
			},
			'theme pattern cache': ( file ) => clearThemePatternCache( host, file ),
			'theme fonts': selfHostFonts,
			'theme thumbnail': ( file ) => writeThemeThumbnail( host, file ),
			'block markup': blockMarkupNotes,
			'theme.json': themeJsonNotes,
			'theme.json file': ( file ) => themeJsonFileNotes( host, file, open ),
			'theme presets': ( file ) => keepThemePresets( host, file ),
			'theme css': themeCssNotes,
			'shared block classes': createSharedBlockClassNotes( host ),
			'external images': externalImageNotes,
			'saved copies': savedCopyNotes,
			'front page template': frontPageTemplateNotes,
		},
		result: {
			'block settings': blockSettingsSource(),
			'block examples': createBlockExampleNotes( host ),
			'site facts': siteFactsSource( host, stated ),
		},
	};
}

// A source that fails says nothing, so the action it follows stands.
async function collect(
	notes: Array< [ string, () => Notes ] >,
	sourceMs: Record< string, number >
): Promise< string[] > {
	const lines: string[] = [];
	for ( const [ name, note ] of notes ) {
		const from = Date.now();
		lines.push(
			...( await Promise.resolve()
				.then( note )
				.catch( () => [] ) )
		);
		sourceMs[ name ] = ( sourceMs[ name ] ?? 0 ) + Date.now() - from;
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
	/** The time each source of notes took since the last take, for a profile. */
	takeSourceMs(): Record< string, number >;
}

/** One agent session's notes: sources that say a thing once keep that here. */
export function createSiteNotes(
	host: StudioAgentHost,
	options: SiteNotesOptions = {}
): SiteNotes {
	const { beforeWrite, write, result } = sources( host, options );
	let sourceMs: Record< string, number > = {};
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
				await collect(
					Object.entries( write ).map( ( [ name, source ] ) => [ name, () => source( file ) ] ),
					sourceMs
				)
			);
			const now = readText( filePath );
			return written === undefined || now === undefined
				? notes
				: [ ...notes, ...rewriteNotes( filePath, written, now ) ];
		},
		async afterResult( sitePath, text ) {
			return collect(
				Object.entries( result ).map( ( [ name, source ] ) => [
					name,
					() => source( sitePath, text ),
				] ),
				sourceMs
			);
		},
		takeSourceMs() {
			const taken = sourceMs;
			sourceMs = {};
			return taken;
		},
	};
}
