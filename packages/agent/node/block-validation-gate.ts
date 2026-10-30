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
import { validateHtmlBlockPolicy } from '@studio/agent/node/block-content-policy';
import {
	bindNavigationLinks,
	blocksSavingElements,
	blockNames,
	insertedTemplates,
	storePresetValues,
	dropCommentsBetweenBlocks,
	validateBlocks,
	type PresetValues,
	type PresetValuesResult,
	type ValidationReportBase,
} from '@studio/agent/node/block-validator';
import { rewriteNotes } from '@studio/agent/node/file-rewrites';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { themePresets } from '@studio/agent/node/theme-presets';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { OpenProblems } from '@studio/agent/node/open-problems';

const THEME_MARKUP =
	/[\\/]wp-content[\\/]themes[\\/][^\\/]+[\\/](templates|parts)[\\/][^\\/]+\.html$/;
// A theme's patterns are the PHP files in its patterns folder, which WordPress
// includes for what they output (WP_Theme::get_block_patterns(),
// WP_Block_Patterns_Registry::get_content()).
const THEME_PATTERN = /[\\/]wp-content[\\/]themes[\\/][^\\/]+[\\/]patterns[\\/].+\.php$/;
// The header comment a pattern opens with, and the newline PHP drops after its closing tag.
const PATTERN_HEADER = /^\s*<\?php\s*\/\*[\s\S]*?\*\/\s*\?>\n?/;

/**
 * A theme pattern's header and the block markup it outputs, when the header
 * is its only PHP, so the file outputs the markup as written.
 */
function splitPattern( content: string ): { header: string; markup: string } | undefined {
	const header = content.match( PATTERN_HEADER )?.[ 0 ];
	if ( header === undefined ) {
		return undefined;
	}
	const markup = content.slice( header.length );
	return markup.includes( '<?' ) ? undefined : { header, markup };
}

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
		const content = readFileSync( filePath, 'utf8' );
		return THEME_PATTERN.test( filePath )
			? splitPattern( content ) !== undefined
			: opensWithBlock( content );
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
	paletteColors?: PresetValuesResult[ 'colors' ];
	/** The font sizes the fix stores as presets. */
	fontSizes?: PresetValuesResult[ 'fontSizes' ];
	/** The spacing values the fix stores as presets. */
	spacingSizes?: PresetValuesResult[ 'spacingSizes' ];
	/** The navigation links the fix binds to the entity they name. */
	boundLinks?: string[];
	/** How many runs of HTML comments between blocks the save drops. */
	droppedComments?: number;
}

/** What saving through the editor changes, for a note. */
export function describeEditorSave( result: MarkupValidation, fixes: string ): string[] {
	return [
		result.invalidBlocks ? `fixes ${ result.invalidBlocks } block(s)${ fixes }` : undefined,
		result.droppedComments
			? `drops ${ result.droppedComments } HTML comment(s) between blocks, which the editor would turn into Classic blocks (normalizeRawBlock in @wordpress/blocks wraps text outside a block in paragraphs) and which render nothing`
			: undefined,
		result.paletteColors?.length ? describePaletteColors( result.paletteColors ) : undefined,
		result.fontSizes?.length ? describeFontSizes( result.fontSizes ) : undefined,
		result.spacingSizes?.length ? describeSpacingSizes( result.spacingSizes ) : undefined,
		result.boundLinks?.length ? describeBoundLinks( result.boundLinks ) : undefined,
	].filter( ( note ): note is string => Boolean( note ) );
}

/** How the editor links a navigation link to the post or term it names, for a note. */
function describeBoundLinks( links: string[] ): string {
	return `binds the url of the navigation link(s) ${ links
		.map( ( label ) => `"${ label }"` )
		.join(
			', '
		) }, which named a page or term by id with no url, to its permalink, as the editor's link picker does (useEntityBinding in @wordpress/block-library): core prints a link's href only from its url (wp-includes/blocks/navigation-link.php)`;
}

/** What the editor inserts for the blocks named, for a note to write them from. */
// Names per element, as many as a note reads at a glance.
const MAX_SAVING_BLOCKS = 12;

async function describeSavingBlocks( html: string, siteUrl: string ): Promise< string[] > {
	const elements = ( await blocksSavingElements( html, siteUrl ).catch( () => [] ) ).filter(
		( { blocks } ) => blocks.length
	);
	if ( ! elements.length ) {
		return [];
	}
	const named = ( blocks: string[] ) =>
		blocks.length > MAX_SAVING_BLOCKS
			? `${ blocks.slice( 0, MAX_SAVING_BLOCKS ).join( ', ' ) } and ${
					blocks.length - MAX_SAVING_BLOCKS
			  } more`
			: blocks.join( ', ' );
	return [
		`The site's blocks whose save makes its elements, created with their defaults (createBlock() and getSaveContent() in @wordpress/blocks): ${ elements
			.map( ( { element, blocks } ) => `<${ element }> ${ named( blocks ) }` )
			.join( '; ' ) }.`,
	];
}

// The core/html blocks the policy keeps for markup no block saves, described
// with the blocks that save their elements.
async function htmlPolicyProblem(
	content: string,
	label: string,
	siteUrl: string
): Promise< string | undefined > {
	const { invalidHtmlBlocks } = validateHtmlBlockPolicy( content );
	if ( ! invalidHtmlBlocks.length ) {
		return undefined;
	}
	return [
		`${ label }: ${ invalidHtmlBlocks.length } core/html block(s) hold markup the editor shows as raw HTML, which convert_to_blocks saves as editable blocks:`,
		...invalidHtmlBlocks.map( ( block ) => `  - line ${ block.line }: ${ block.issues[ 0 ] }` ),
		...( await describeSavingBlocks(
			invalidHtmlBlocks.map( ( block ) => block.content ).join( '\n' ),
			siteUrl
		) ),
		...( await describeTemplates(
			[ ...new Set( invalidHtmlBlocks.flatMap( ( block ) => block.block ?? [] ) ) ],
			siteUrl
		) ),
	].join( '\n' );
}

async function describeTemplates( names: string[], siteUrl: string ): Promise< string[] > {
	const templates = await insertedTemplates( names, siteUrl ).catch( () => [] );
	return templates.map(
		( { name, markup } ) =>
			`What the site's block editor inserts for ${ name }, from its default inserter variation (createBlock in @wordpress/blocks), to write it from:\n${ markup }`
	);
}

/**
 * What the editor stores for the markup: comments between blocks dropped, palette
 * colors as presets, entity links bound. `invalidBefore` counts the problems in
 * the content it replaces.
 */
async function storeAsTheEditorDoes(
	content: string,
	siteUrl: string,
	presetValues: PresetValues,
	invalidBefore: () => Promise< number >
) {
	const between = await dropCommentsBetweenBlocks( content, siteUrl );
	const presets = await storePresetValues( between.content, siteUrl, presetValues );
	const bound = await bindNavigationLinks( presets.content, siteUrl );
	const stored = {
		content: bound.content,
		changed:
			between.comments > 0 ||
			presets.colors.length > 0 ||
			presets.fontSizes.length > 0 ||
			presets.spacingSizes.length > 0 ||
			bound.links.length > 0,
		...( between.comments && { droppedComments: between.comments } ),
		...( presets.colors.length && { paletteColors: presets.colors } ),
		...( presets.fontSizes.length && { fontSizes: presets.fontSizes } ),
		...( presets.spacingSizes.length && { spacingSizes: presets.spacingSizes } ),
		...( bound.links.length && { boundLinks: bound.links } ),
	};
	// A save stands only when the editor finds no more problems in it than in
	// what it replaces, whatever the pass that changed it.
	if (
		stored.changed &&
		( await validateBlocks( stored.content, siteUrl ) ).invalidBlocks > ( await invalidBefore() )
	) {
		return { content, changed: false };
	}
	return stored;
}

/** How the editor stores colors written as palette values, for a note. */
function describePaletteColors( colors: PresetValuesResult[ 'colors' ] ): string {
	const each = [
		...new Set( colors.map( ( { color, slug } ) => `${ color } as the palette's ${ slug }` ) ),
	];
	return `stores ${ each.join(
		', '
	) }, as the editor stores a palette color (encodeColorValueWithPalette in @wordpress/block-editor), so it follows the palette`;
}

/** How the editor stores font sizes written as preset sizes, for a note. */
function describeFontSizes( sizes: PresetValuesResult[ 'fontSizes' ] ): string {
	const each = [
		...new Set( sizes.map( ( { size, slug } ) => `${ size } as the font size ${ slug }` ) ),
	];
	return `stores ${ each.join(
		', '
	) }, as the editor stores a font size preset (getFontSizeObjectByValue in @wordpress/block-editor), so it follows the preset`;
}

/** How the editor stores spacing written as preset sizes, for a note. */
function describeSpacingSizes( sizes: PresetValuesResult[ 'spacingSizes' ] ): string {
	const each = [
		...new Set( sizes.map( ( { size, slug } ) => `${ size } as the spacing size ${ slug }` ) ),
	];
	return `stores ${ each.join(
		', '
	) }, as the editor stores a spacing size preset (getPresetValueFromCustomValue in @wordpress/block-editor), so it follows the preset`;
}

/**
 * The palette colors, font sizes and spacing sizes markup in \`theme\` renders with (the
 * active theme's by default), as WordPress resolves them.
 */
export async function sitePresetValues(
	host: StudioAgentHost,
	siteRoot: string,
	theme?: string
): Promise< PresetValues > {
	const presets = await readWordPressSite( siteRoot, ( site ) =>
		themePresets( host, site, theme )
	).catch( () => undefined );
	return {
		colors: presets?.colors ?? [],
		fontSizes: presets?.fontSizes ?? [],
		spacingSizes: presets?.spacingSizes ?? [],
	};
}

const NO_PRESETS: PresetValues = { colors: [], fontSizes: [], spacingSizes: [] };

/** Validates one block markup file, with the lossless fix for the caller to save. */
export async function validateBlockMarkupFile(
	filePath: string,
	siteUrl: string,
	presetValues: PresetValues = NO_PRESETS
): Promise< FileValidation > {
	const label = filePath.split( path.sep ).slice( -2 ).join( '/' );
	const content = await readFile( filePath, 'utf8' );
	// A pattern is validated for the markup it outputs, and saved under its header.
	const pattern = THEME_PATTERN.test( filePath ) ? splitPattern( content ) : undefined;
	if ( THEME_PATTERN.test( filePath ) && ! pattern ) {
		return { contentHash: hash( content ), summary: `${ label }: not validated, as it holds PHP` };
	}

	const result = await validateBlockMarkup(
		pattern?.markup ?? content,
		label,
		siteUrl,
		presetValues
	);
	if ( result.fixedContent === undefined ) {
		return { contentHash: hash( content ), summary: result.summary, problem: result.problem };
	}
	const notes = describeEditorSave( result, '' );
	return {
		contentHash: hash( content ),
		summary: `${ result.summary }; saved through the block editor, which ${ notes.join(
			' and '
		) }`,
		...( result.problem && { problem: result.problem } ),
		fixedContent: ( pattern?.header ?? '' ) + result.fixedContent,
	};
}

/**
 * Validates block markup against what each block saves on the site, and
 * against the core/html policy. A lossless editor fix is returned for the
 * caller to save where the markup lives, whatever the policy finds.
 */
// A block delimiter as WordPress's block parser reads one: its closer slash,
// namespace, name, attributes and void slash (the tokenizer of
// @wordpress/block-serialization-default-parser, as WP_Block_Parser::next_token()).
const DELIMITER =
	/<!--\s+(\/)?wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)\s+({(?:(?=([^}]+|}+(?=})|(?!}\s+\/?-->)[^]))\5)*?}\s+)?(\/)?-->/g;

/**
 * The blocks WordPress's block parser does not close with their own closer. It
 * closes the innermost open block at any closer, whatever its name, and at the
 * end of the content gives each block still open the rest of the content
 * (WP_Block_Parser::add_block_from_stack()), so the page renders that rest once
 * for each, and the editor saves it so.
 */
function unclosedBlocks( content: string ): string[] {
	const lineAt = ( offset: number ) => content.slice( 0, offset ).split( '\n' ).length;
	const open: { name: string; line: number }[] = [];
	const problems: string[] = [];
	for ( const match of content.matchAll( DELIMITER ) ) {
		const [ , closer, namespace = 'core/', name, , , isVoid ] = match;
		const block = { name: `${ namespace }${ name }`, line: lineAt( match.index ) };
		if ( isVoid ) {
			continue;
		}
		if ( ! closer ) {
			open.push( block );
			continue;
		}
		// The blocks opened inside the one this closer names have no closer of
		// their own; a closer that names no open block closes the innermost.
		const at = open.map( ( opened ) => opened.name ).lastIndexOf( block.name );
		const unclosed = at === -1 ? open.slice( -1 ) : open.slice( at + 1 );
		open.length = at === -1 ? Math.max( 0, open.length - 1 ) : at;
		problems.push(
			...unclosed.map(
				( opened ) =>
					`  - line ${ opened.line }: ${ opened.name } has no closer of its own, so the parser closes it at the ${ block.name } closer on line ${ block.line }`
			)
		);
	}
	return [
		...problems,
		...open.map(
			( { name, line } ) =>
				`  - line ${ line }: ${ name } is never closed, so the parser gives it the rest of the content`
		),
	];
}

export async function validateBlockMarkup(
	content: string,
	label: string,
	siteUrl: string,
	presetValues: PresetValues = NO_PRESETS
): Promise< MarkupValidation > {
	// The editor's save of blocks parsed this way repeats what follows them,
	// so nothing is saved for it.
	const unclosed = unclosedBlocks( content );
	if ( unclosed.length ) {
		return {
			summary: `${ label }: ${ unclosed.length } block(s) not closed`,
			problem: [
				`${ label }: ${ unclosed.length } block(s) are not closed by their own closer, so WordPress's block parser nests what follows inside them and, for a block still open at the end, renders the rest of the content once more (WP_Block_Parser::add_block_from_stack() in wp-includes/class-wp-block-parser.php). Close each where its markup ends:`,
				...unclosed,
			].join( '\n' ),
		};
	}
	const policy = await htmlPolicyProblem( content, label, siteUrl );
	const result = await validateSavedMarkup( content, label, siteUrl, presetValues );
	return policy
		? {
				...result,
				summary: `${ result.summary }; core/html policy failed`,
				problem: [ policy, ...( result.problem ? [ result.problem ] : [] ) ].join( '\n' ),
		  }
		: result;
}

async function validateSavedMarkup(
	content: string,
	label: string,
	siteUrl: string,
	presetValues: PresetValues
): Promise< MarkupValidation > {
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
		} = await storeAsTheEditorDoes( content, siteUrl, presetValues, async () => 0 );
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
		? await storeAsTheEditorDoes( fix.fixedContent, siteUrl, presetValues, async () =>
				lost.size ? ( await validateBlocks( fix.fixedContent, siteUrl ) ).invalidBlocks : 0
		  )
		: undefined;
	const saved = stored && {
		fixedContent: stored.content,
		invalidBlocks: fixedBlocks,
		...( stored.paletteColors && { paletteColors: stored.paletteColors } ),
		...( stored.fontSizes && { fontSizes: stored.fontSizes } ),
		...( stored.spacingSizes && { spacingSizes: stored.spacingSizes } ),
		...( stored.boundLinks && { boundLinks: stored.boundLinks } ),
		...( stored.droppedComments && { droppedComments: stored.droppedComments } ),
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
	// The result once it has come, which a call that does not wait can report.
	validated?: FileValidation;
	reported?: string;
}

export class BlockValidationGate {
	private readonly files = new Map< string, Tracked >();

	constructor(
		private readonly validateFile: (
			filePath: string,
			siteRoot: string
		) => Promise< FileValidation >,
		private readonly open?: OpenProblems
	) {}

	/** Queues a written file and starts validating it in the background. */
	track( filePath: string, siteRoot: string ): void {
		if ( isBlockMarkupFile( filePath ) ) {
			this.files.set( filePath, this.start( { siteRoot }, filePath ) );
		}
	}

	/**
	 * Waits for every queued file and returns what is new to report. With
	 * `ready`, waits for none: reports only the files whose validation of their
	 * current content has come, leaving out `except`, the file the call about to
	 * run writes, whose text a saved fix would change under it.
	 */
	async settle( { ready = false, except }: { ready?: boolean; except?: string } = {} ): Promise< {
		summaries: string[];
		problems: string[];
		saved: string[];
	} > {
		const summaries: string[] = [];
		const problems: string[] = [];
		const saved: string[] = [];
		for ( const [ filePath, tracked ] of this.files ) {
			if ( ready && ( filePath === except || ! ( await isCurrent( filePath, tracked ) ) ) ) {
				continue;
			}
			const result = await this.current( filePath, tracked.siteRoot ).then(
				( current ) => current && this.applyFix( filePath, current, saved )
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
		return { summaries, problems, saved };
	}

	/**
	 * Saves a validation's lossless fix, now that it holds the file's current
	 * content, and returns the validation of the fixed file.
	 */
	private async applyFix(
		filePath: string,
		result: FileValidation,
		saved: string[]
	): Promise< FileValidation | undefined > {
		const { fixedContent, ...validation } = result;
		if ( fixedContent === undefined ) {
			return result;
		}
		const content = await readFile( filePath, 'utf8' ).catch( () => undefined );
		if ( content === undefined || hash( content ) !== result.contentHash ) {
			// Written again while it was validated: validate what it holds now.
			const current = await this.current( filePath, this.files.get( filePath )!.siteRoot );
			return current && this.applyFix( filePath, current, saved );
		}
		await writeFile( filePath, fixedContent, 'utf8' );
		saved.push( filePath );
		const fixed = {
			...validation,
			// The agent holds the text it wrote, which an edit would no longer find.
			summary: [ validation.summary, ...rewriteNotes( filePath, content, fixedContent ) ].join(
				'\n'
			),
			contentHash: hash( fixedContent ),
		};
		const tracked = this.files.get( filePath )!;
		tracked.result = Promise.resolve( fixed );
		tracked.validated = fixed;
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
		const tracked = this.files.get( filePath ) ?? this.start( { siteRoot }, filePath );
		let result = await tracked.result;
		if ( result.contentHash !== hash( content ) ) {
			result = await this.start( tracked, filePath ).result;
		}
		this.files.set( filePath, tracked );
		return result;
	}

	/** Starts validating a file's current content. */
	private start( tracked: Omit< Tracked, 'result' > & Partial< Tracked >, filePath: string ) {
		const result = this.validate( filePath, tracked.siteRoot );
		Object.assign( tracked, { result, validated: undefined } );
		void result.then( ( validated ) => {
			if ( tracked.result === result ) {
				tracked.validated = validated;
			}
		} );
		return tracked as Tracked;
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

// Whether a file's validation has come, for the content it holds now.
async function isCurrent( filePath: string, tracked: Tracked ): Promise< boolean > {
	if ( ! tracked.validated ) {
		return false;
	}
	const content = await readFile( filePath, 'utf8' ).catch( () => undefined );
	return content !== undefined && hash( content ) === tracked.validated.contentHash;
}

// The theme a file is in, by its folder under wp-content/themes.
const themeOf = ( siteRoot: string, filePath: string ) =>
	path
		.relative( siteRoot, filePath )
		.split( path.sep )
		.join( '/' )
		.match( /^wp-content\/themes\/([^/]+)\// )?.[ 1 ];

function validateWithSite( host: StudioAgentHost ) {
	return async ( filePath: string, siteRoot: string ): Promise< FileValidation > =>
		validateBlockMarkupFile(
			filePath,
			( await host.sites.resolve( siteRoot ) ).url,
			await sitePresetValues( host, siteRoot, themeOf( siteRoot, filePath ) )
		);
}

/** A session's block validation, on the site each file belongs to. */
export function createBlockValidationGate(
	host: StudioAgentHost,
	open: OpenProblems
): BlockValidationGate {
	return new BlockValidationGate( validateWithSite( host ), open );
}
