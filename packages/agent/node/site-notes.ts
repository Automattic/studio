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
import { rewriteNotes } from '@studio/agent/node/file-rewrites';
import { repeatedStyleValueNotes } from '@studio/agent/node/repeated-style-values';
import { savedCopyNotes } from '@studio/agent/node/saved-copies';
import { createSharedBlockClassNotes } from '@studio/agent/node/shared-block-classes';
import { readSiteFacts } from '@studio/agent/node/site-facts';
import { resolveSiteFile, type SiteFile } from '@studio/agent/node/site-file';
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
	quoteFontFamilies,
	selfHostFonts,
	themeJsonNotes,
} from '@studio/agent/node/site-file-guards';
import { themeCssNotes } from '@studio/agent/node/theme-css-notes';
import { themeJsonFileNotes, themeJsonSyntaxNotes } from '@studio/agent/node/theme-json-files';
import { keepThemePresets } from '@studio/agent/node/theme-presets';
import { themeRootPaddingNotes } from '@studio/agent/node/theme-root-padding';
import { themeStyleOverrideNotes } from '@studio/agent/node/theme-style-overrides';
import { writeThemeThumbnail } from '@studio/agent/node/theme-thumbnail';
import { createResultNotes } from '@studio/agent/shared/result-notes';
import type { BlockValidationGate } from '@studio/agent/node/block-validation-gate';
import type { OpenProblems } from '@studio/agent/node/open-problems';
import type { SettledChanges } from '@studio/agent/node/site-changes';
import type { StudioAgentHost } from '@studio/agent/shared/host';

type Notes = string[] | Promise< string[] >;

interface Sources {
	beforeWrite: Array< ( file: SiteFile, text: string ) => Notes >;
	// Named, for the time each takes in a profile. `before` is the file's text
	// before a file tool's write, '' for a file it creates, and unknown for any
	// other write.
	write: Record< string, ( file: SiteFile, before?: string ) => Notes >;
	// The sources that rewrite the file just written, before the others: a
	// file tool's call waits for them, so the agent goes on from the file as
	// Studio leaves it, not the text its own call left there. A cheap check
	// whose note must reach that call's own result, not the next one's, is
	// one of these too.
	fix: Record< string, ( file: SiteFile ) => Notes >;
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

// The notes every surface adds to a result, such as the settings of the core
// blocks it shows.
function resultNotesSource( host: StudioAgentHost ): Sources[ 'result' ][ number ] {
	const notes = createResultNotes( host );
	return async ( sitePath, text ) => [ await notes( sitePath, text ) ].filter( Boolean );
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
		// In order: each sees the file as the ones before it left it, and the
		// write sources see it as these leave it.
		fix: {
			'full width blocks': freeFullWidthBlocks,
			'font family names': quoteFontFamilies,
			'theme fonts': selfHostFonts,
			'theme presets': ( file ) => keepThemePresets( host, file ),
			'theme json syntax': ( file ) => themeJsonSyntaxNotes( file, open ),
		},
		write: {
			// Before the gate reads the file and the theme's presets for its save.
			'repeated style values': ( file ) =>
				repeatedStyleValueNotes( host, file, { gateSaves: Boolean( gate ) } ),
			'block validation': ( { siteRoot, relativePath } ) => {
				gate?.track( path.join( siteRoot, relativePath ), siteRoot );
				return [];
			},
			'theme pattern cache': ( file ) => clearThemePatternCache( host, file ),
			'theme thumbnail': ( file ) => writeThemeThumbnail( host, file ),
			'block markup': blockMarkupNotes,
			'theme.json': themeJsonNotes,
			'theme.json file': ( file ) => themeJsonFileNotes( host, file, open ),
			'theme root padding': themeRootPaddingNotes,
			'theme style overrides': themeStyleOverrideNotes,
			'theme css': themeCssNotes,
			'shared block classes': createSharedBlockClassNotes( host ),
			'external images': externalImageNotes,
			'saved copies': savedCopyNotes,
			'front page template': frontPageTemplateNotes,
		},
		result: {
			'block settings': resultNotesSource( host ),
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

// A file not yet written by its folder's real path.
function realPath( filePath: string ): string {
	try {
		return fs.realpathSync( filePath );
	} catch {
		const folder = path.dirname( filePath );
		return folder === filePath
			? filePath
			: path.join( realPath( folder ), path.basename( filePath ) );
	}
}

export function readFileText( filePath: string ): string | undefined {
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
	afterWrite( filePath: string, written?: string, fixed?: boolean ): Promise< string[] >;
	/**
	 * What Studio fixed in a file just written, as a file tool's call reports
	 * before its result, so its afterWrite() is `fixed`.
	 */
	fixWrite( filePath: string ): Promise< string[] >;
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
	const { beforeWrite, write, fix, result } = sources( host, options );
	let sourceMs: Record< string, number > = {};
	// The notes each file's last write gave, by file: a note said once while
	// it stands, and again should it come back after a write that gave none.
	const standing = new Map< string, string[] >();
	// Each file's text before the file tool's write in progress.
	const held = new Map< string, string >();
	const once = ( file: string, notes: string[] ) => {
		const said = standing.get( file ) ?? [];
		standing.set( file, notes );
		return notes.filter( ( note ) => ! said.includes( note ) );
	};
	const fixes = async ( file: SiteFile, key: string ) =>
		once(
			`fix ${ key }`,
			await collect(
				Object.entries( fix ).map( ( [ name, source ] ) => [ name, () => source( file ) ] ),
				sourceMs
			)
		);
	return {
		async beforeWrite( filePath, text = '' ) {
			// Unlike a note, a refusal that fails stops the write.
			const file = resolveSiteFile( filePath );
			if ( file ) {
				held.set( realPath( filePath ), readFileText( filePath ) ?? '' );
			}
			const refusals = file
				? ( await Promise.all( beforeWrite.map( ( source ) => source( file, text ) ) ) ).flat()
				: [];
			if ( ! refusals.length ) {
				return undefined;
			}
			held.delete( realPath( filePath ) );
			return `Not run: ${ refusals.join( ' ' ) }`;
		},
		async fixWrite( filePath ) {
			const file = resolveSiteFile( filePath );
			return file ? fixes( file, realPath( filePath ) ) : [];
		},
		async afterWrite( filePath, written = readFileText( filePath ), fixed = false ) {
			const file = resolveSiteFile( filePath );
			if ( ! file ) {
				return [];
			}
			// One file, however the call names it, as /var and /private/var on macOS.
			const key = realPath( filePath );
			const before = held.get( key );
			held.delete( key );
			const notes = [
				...( fixed ? [] : await fixes( file, key ) ),
				...once(
					key,
					await collect(
						Object.entries( write ).map( ( [ name, source ] ) => [
							name,
							() => source( file, before ),
						] ),
						sourceMs
					)
				),
			];
			const now = readFileText( filePath );
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

/**
 * What a surface reports on a call that ran, the same on every surface: what
 * `changes` settled (their summaries, then their problems), then the notes on
 * each file the call wrote, one at a time as the notes on each can save a fix
 * to the same file, then on its result about `site`.
 *
 * The files written are `writtenFile`, a file tool's, then those the changes
 * found written. `left` is the text the file tool left in `writtenFile` once
 * Studio's fixes to it (fixWrite) were made.
 */
export async function notesAfterCall(
	siteNotes: SiteNotes,
	{
		changes,
		writtenFile,
		left,
		site,
		resultText,
	}: {
		changes: SettledChanges[];
		writtenFile?: string;
		left?: string;
		site?: string;
		resultText: string;
	},
	time: < T >( stage: string, run: () => Promise< T > ) => Promise< T > = ( _stage, run ) => run()
): Promise< string[] > {
	const written = [
		...( writtenFile ? [ writtenFile ] : [] ),
		...changes.flatMap( ( changed ) => changed.written ),
	];
	const notes: string[] = [];
	for ( const file of new Set( written ) ) {
		notes.push(
			...( await time( 'fileNotes', () =>
				file === writtenFile
					? siteNotes.afterWrite( file, left, true )
					: siteNotes.afterWrite( file )
			) )
		);
	}
	if ( site ) {
		notes.push(
			...( await time( 'resultNotes', () => siteNotes.afterResult( site, resultText ) ) )
		);
	}
	return [
		...changes.flatMap( ( changed ) => changed.summaries ),
		...changes.flatMap( ( changed ) => changed.problems ),
		...notes,
	];
}
