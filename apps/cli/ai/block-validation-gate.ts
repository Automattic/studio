/**
 * Block validation as a gate the harness runs, not a tool the model must
 * remember to call.
 *
 * Writing block markup (a theme template or part, or any file that opens with a
 * block, as a page draft does wherever it is written) queues that file. Validation starts in the background at once,
 * and what puts content on the site or renders it (a shell command, which
 * runs WP-CLI, or take_screenshot) waits for it first. A fix the block editor
 * can make losslessly is applied to the file silently, once validation has
 * settled and only while the file still holds the content validated, so an
 * edit made meanwhile is never overwritten; the model hears only about what it
 * has to change itself.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { validateHtmlBlockPolicy } from 'cli/ai/block-content-policy';
import {
	bindNavigationLinks,
	blockNames,
	insertedTemplates,
	storePaletteColors,
	validateBlocks,
	type PaletteColorsResult,
	type ValidationReportBase,
} from 'cli/ai/block-validator';
import { getOpenProblems, type OpenProblems } from 'cli/ai/open-problems';
import { readWordPressSite } from 'cli/ai/site-database';
import { themePresets } from 'cli/ai/theme-presets';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';

const THEME_MARKUP =
	/[\\/]wp-content[\\/]themes[\\/][^\\/]+[\\/](templates|parts)[\\/][^\\/]+\.html$/;

/**
 * Whether content is block markup: it opens with a block's comment delimiter,
 * as WordPress serializes a block (get_comment_delimited_block_content()).
 * A draft is one wherever it is written; code that only mentions a delimiter
 * does not open with one.
 */
export function opensWithBlock( content: string ): boolean {
	return content.trimStart().startsWith( '<!-- wp:' );
}

/** Whether a file holds block markup the gate validates: a theme template or part, or any block markup. */
export function isBlockMarkupFile( filePath: string ): boolean {
	if ( THEME_MARKUP.test( filePath ) ) {
		return true;
	}
	try {
		return opensWithBlock( readFileSync( filePath, 'utf8' ) );
	} catch {
		return false;
	}
}

function hash( content: string ): string {
	return createHash( 'sha1' ).update( content ).digest( 'hex' );
}

function oneLine( html: string, length: number ): string {
	const flat = html.replace( /\s+/g, ' ' ).trim();
	return flat.length > length ? `${ flat.slice( 0, length ) }…` : flat;
}

/**
 * Each invalid block with every mismatch the editor found, and the HTML the
 * block saves from its comment attributes — the markup that validates.
 */
function describeInvalidBlocks(
	report: ValidationReportBase,
	lost = new Map< string, string >()
): string[] {
	return report.results
		.filter( ( result ) => ( lost.size ? lost.has( result.place ?? '' ) : ! result.isValid ) )
		.slice( 0, 5 )
		.flatMap( ( result ) => [
			`  - ${ result.blockName }: ${
				lost.has( result.place ?? '' )
					? `the editor's fix would ${ lost.get( result.place ?? '' ) }; `
					: ''
			}${ result.issues.slice( 0, 3 ).join( '; ' ) || 'does not match what the block saves' }`,
			...( result.originalContent
				? [ `    written: ${ oneLine( result.originalContent, 700 ) }` ]
				: [] ),
			...( result.expectedContent
				? [ `    the block saves: ${ oneLine( result.expectedContent, 700 ) }` ]
				: [] ),
		] );
}

interface FileValidation {
	/** The hash of the content validated. */
	contentHash: string;
	summary: string;
	problem?: string;
	/** What the block editor would save instead, losing nothing. */
	fixedContent?: string;
}

interface MarkupValidation {
	summary: string;
	problem?: string;
	/** What the block editor would save instead, when that loses nothing. */
	fixedContent?: string;
	invalidBlocks?: number;
	/** The palette colors the fix stores as presets. */
	paletteColors?: PaletteColorsResult[ 'colors' ];
	/** The navigation links the fix binds to the entity they name. */
	boundLinks?: string[];
}

/** How the editor links a navigation link to the post or term it names, for a note. */
export function describeBoundLinks( links: string[] ): string {
	return `binds the url of the navigation link(s) ${ links
		.map( ( label ) => `"${ label }"` )
		.join(
			', '
		) }, which named a page or term by id with no url, to its permalink, as the editor's link picker does (useEntityBinding in @wordpress/block-library): core prints a link's href only from its url (wp-includes/blocks/navigation-link.php)`;
}

/** What the editor inserts for the blocks named, for a note to write them from. */
async function describeTemplates( names: string[], siteUrl: string ): Promise< string[] > {
	const templates = await insertedTemplates( names, siteUrl ).catch( () => [] );
	return templates.map(
		( { name, markup } ) =>
			`What the site's block editor inserts for ${ name }, from its default inserter variation (createBlock in @wordpress/blocks), to write it from:\n${ markup }`
	);
}

/** What the editor stores for the palette colors and entity links the markup writes otherwise. */
async function storeAsTheEditorDoes(
	content: string,
	siteUrl: string,
	palette: Array< [ string, string ] >
) {
	const presets = await storePaletteColors( content, siteUrl, palette );
	const bound = await bindNavigationLinks( presets.content, siteUrl );
	return {
		content: bound.content,
		changed: presets.colors.length > 0 || bound.links.length > 0,
		...( presets.colors.length && { paletteColors: presets.colors } ),
		...( bound.links.length && { boundLinks: bound.links } ),
	};
}

/** How the editor stores colors written as palette values, for a note. */
export function describePaletteColors( colors: PaletteColorsResult[ 'colors' ] ): string {
	const each = [
		...new Set( colors.map( ( { color, slug } ) => `${ color } as the palette's ${ slug }` ) ),
	];
	return `stores ${ each.join(
		', '
	) }, as the editor stores a palette color (encodeColorValueWithPalette in @wordpress/block-editor), so it follows the palette`;
}

/** The colors of a site's palette, as WordPress resolves them. */
export async function sitePalette( siteRoot: string ): Promise< Array< [ string, string ] > > {
	return (
		( await readWordPressSite( siteRoot, themePresets ).catch( () => undefined ) )?.colors ?? []
	);
}

/** Validates one block markup file, with the lossless fix for the caller to save. */
export async function validateBlockMarkupFile(
	filePath: string,
	siteUrl: string,
	palette: Array< [ string, string ] > = []
): Promise< FileValidation > {
	const label = filePath.split( path.sep ).slice( -2 ).join( '/' );
	const content = await readFile( filePath, 'utf8' );

	const result = await validateBlockMarkup( content, label, siteUrl, palette );
	if ( result.fixedContent === undefined ) {
		return { contentHash: hash( content ), summary: result.summary, problem: result.problem };
	}
	const notes = [
		result.invalidBlocks ? `fixes ${ result.invalidBlocks } block(s)` : undefined,
		result.paletteColors?.length ? describePaletteColors( result.paletteColors ) : undefined,
		result.boundLinks?.length ? describeBoundLinks( result.boundLinks ) : undefined,
	].filter( Boolean );
	return {
		contentHash: hash( content ),
		summary: `${ result.summary }; saved through the block editor, which ${ notes.join(
			' and '
		) }`,
		...( result.problem && { problem: result.problem } ),
		fixedContent: result.fixedContent,
	};
}

/**
 * Validates block markup against what each block saves on the site, and
 * against the core/html policy. A lossless editor fix is returned for the
 * caller to save where the markup lives.
 */
export async function validateBlockMarkup(
	content: string,
	label: string,
	siteUrl: string,
	palette: Array< [ string, string ] > = []
): Promise< MarkupValidation > {
	const policy = validateHtmlBlockPolicy( content );
	if ( policy.invalidHtmlBlocks.length > 0 ) {
		return {
			summary: `${ label }: core/html policy failed`,
			problem: [
				`${ label }: ${ policy.invalidHtmlBlocks.length } core/html block(s) must become editable blocks:`,
				...policy.invalidHtmlBlocks.map(
					( block ) => `  - line ${ block.line }: ${ block.issues[ 0 ] }`
				),
				...( await describeTemplates(
					[ ...new Set( policy.invalidHtmlBlocks.flatMap( ( block ) => block.block ?? [] ) ) ],
					siteUrl
				) ),
			].join( '\n' ),
		};
	}

	const report = await validateBlocks( content, siteUrl );
	if ( report.error ) {
		return {
			summary: `${ label }: not validated (${ report.error })`,
		};
	}
	const valid = `${ label }: ${ report.totalBlocks }/${ report.totalBlocks } blocks valid`;
	if ( report.invalidBlocks === 0 ) {
		const {
			content: stored,
			changed,
			...notes
		} = await storeAsTheEditorDoes( content, siteUrl, palette );
		return changed ? { summary: valid, fixedContent: stored, ...notes } : { summary: valid };
	}

	const fix = report.proposedFix;
	if ( ! fix || fix.report.error || fix.report.invalidBlocks > 0 ) {
		return {
			summary: `${ label }: ${ report.invalidBlocks } invalid block(s)`,
			problem: [
				`${ label }: ${ report.invalidBlocks } invalid block(s), which the block editor cannot fix:`,
				...describeInvalidBlocks( report ),
				...( await describeTemplates(
					blockNames(
						report.results
							.filter( ( result ) => ! result.isValid )
							.map( ( result ) => result.originalContent )
							.join( '\n' )
					),
					siteUrl
				) ),
			].join( '\n' ),
		};
	}

	// A block stays as written when the fix loses something from it or from a
	// block it is inside; the editor's fix is saved for the rest.
	const lost = new Map( fix.losses.map( ( loss ) => [ loss.place, loss.lost ] ) );
	const keptAsWritten = ( place = '' ) =>
		[ ...lost.keys() ].some( ( at ) => place === at || place.startsWith( `${ at }/` ) );
	const fixedBlocks = report.results.filter(
		( result ) => ! result.isValid && ! keptAsWritten( result.place )
	).length;
	const stored = fixedBlocks
		? await storeAsTheEditorDoes( fix.fixedContent, siteUrl, palette )
		: undefined;
	const saved = stored && {
		fixedContent: stored.content,
		invalidBlocks: fixedBlocks,
		...( stored.paletteColors && { paletteColors: stored.paletteColors } ),
		...( stored.boundLinks && { boundLinks: stored.boundLinks } ),
	};
	if ( lost.size === 0 ) {
		return { summary: valid, ...saved };
	}
	return {
		summary: `${ label }: ${ report.invalidBlocks - fixedBlocks } invalid block(s)`,
		problem: [
			`${ label }: ${ lost.size } block(s) do not match what the block saves, and the editor's fix would lose something from them. Change them to what the block saves, or change the comment attributes the block saves them from (className and style carry extra classes and styles):`,
			...describeInvalidBlocks( report, lost ),
		].join( '\n' ),
		...saved,
	};
}

interface Tracked {
	siteRoot: string;
	result: Promise< FileValidation >;
	reported?: string;
}

export class BlockValidationGate {
	private readonly files = new Map< string, Tracked >();

	constructor(
		private readonly validateFile: (
			filePath: string,
			siteRoot: string
		) => Promise< FileValidation > = validateWithSite,
		private readonly open?: OpenProblems
	) {}

	/** Queues a written file and starts validating it in the background. */
	track( filePath: string, siteRoot: string ): void {
		if ( isBlockMarkupFile( filePath ) ) {
			this.files.set( filePath, { siteRoot, result: this.validate( filePath, siteRoot ) } );
		}
	}

	/** Waits for every queued file and returns what is new to report. */
	async settle(): Promise< { summaries: string[]; problems: string[] } > {
		const summaries: string[] = [];
		const problems: string[] = [];
		for ( const [ filePath, tracked ] of this.files ) {
			const result = await this.current( filePath, tracked.siteRoot ).then(
				( current ) => current && this.applyFix( filePath, current )
			);
			this.open?.record( tracked.siteRoot, filePath, result?.problem );
			if ( ! result ) {
				this.files.delete( filePath );
				continue;
			}
			const reportKey = `${ result.contentHash } ${ result.summary }`;
			if ( reportKey !== tracked.reported ) {
				tracked.reported = reportKey;
				summaries.push( result.summary );
				problems.push( ...( result.problem ? [ result.problem ] : [] ) );
			}
		}
		return { summaries, problems };
	}

	/**
	 * Saves a validation's lossless fix, now that it holds the file's current
	 * content, and returns the validation of the fixed file.
	 */
	private async applyFix(
		filePath: string,
		result: FileValidation
	): Promise< FileValidation | undefined > {
		const { fixedContent, ...validation } = result;
		if ( fixedContent === undefined ) {
			return result;
		}
		const content = await readFile( filePath, 'utf8' ).catch( () => undefined );
		if ( content === undefined || hash( content ) !== result.contentHash ) {
			// Written again while it was validated: validate what it holds now.
			const current = await this.current( filePath, this.files.get( filePath )!.siteRoot );
			return current && this.applyFix( filePath, current );
		}
		await writeFile( filePath, fixedContent, 'utf8' );
		const fixed = { ...validation, contentHash: hash( fixedContent ) };
		this.files.get( filePath )!.result = Promise.resolve( fixed );
		return fixed;
	}

	/**
	 * The validation of a file's current content, reusing the last one while
	 * the file is unchanged; undefined once the file is gone.
	 */
	private async current(
		filePath: string,
		siteRoot: string
	): Promise< FileValidation | undefined > {
		const content = await readFile( filePath, 'utf8' ).catch( () => undefined );
		if ( content === undefined ) {
			return undefined;
		}
		const tracked = this.files.get( filePath ) ?? {
			siteRoot,
			result: this.validate( filePath, siteRoot ),
		};
		let result = await tracked.result;
		if ( result.contentHash !== hash( content ) ) {
			tracked.result = this.validate( filePath, siteRoot );
			result = await tracked.result;
		}
		this.files.set( filePath, tracked );
		return result;
	}

	/** Validates a file; a validation that cannot run is reported, never skipped. */
	private validate( filePath: string, siteRoot: string ): Promise< FileValidation > {
		return this.validateFile( filePath, siteRoot ).catch( async ( error: unknown ) => ( {
			contentHash: hash( ( await readFile( filePath, 'utf8' ).catch( () => '' ) ) ?? '' ),
			summary: `${ filePath.split( path.sep ).slice( -2 ).join( '/' ) }: not validated (${
				error instanceof Error ? error.message : String( error )
			})`,
		} ) );
	}
}

async function validateWithSite( filePath: string, siteRoot: string ): Promise< FileValidation > {
	return validateBlockMarkupFile(
		filePath,
		getSiteUrl( await getSiteByFolder( siteRoot ) ),
		await sitePalette( siteRoot )
	);
}

const gates = new WeakMap< object, BlockValidationGate >();

export function getBlockValidationGate( session: object ): BlockValidationGate {
	let gate = gates.get( session );
	if ( ! gate ) {
		gate = new BlockValidationGate( validateWithSite, getOpenProblems( session ) );
		gates.set( session, gate );
	}
	return gate;
}
