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
	BLOCK_DELIMITER,
	dropCommentsBetweenBlocks,
	validateBlocks,
	type BlockEditor,
	type PresetValues,
	type PresetValuesResult,
	type ValidationReportBase,
} from '@studio/agent/node/block-validator';
import { boundedText } from '@studio/agent/node/bounded-list';
import { rewriteNotes } from '@studio/agent/node/file-rewrites';
import { hash } from '@studio/agent/node/post-copies';
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

/** The editor that edits markup: the Site Editor a theme's template or part, saved or a file. */
export function blockEditorOf( place: { file?: string; type?: string } ): BlockEditor {
	return ( place.file && THEME_MARKUP.test( place.file ) ) ||
		place.type === 'wp_template' ||
		place.type === 'wp_template_part'
		? 'site'
		: 'post';
}
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
	/** Diagnostics for blocks corrected by the save. */
	corrections?: string[];
	/** The navigation links the fix binds to the entity they name. */
	boundLinks?: string[];
	/** How many runs of HTML comments between blocks the save drops. */
	droppedComments?: number;
	/** The blocks whose text written beside their inner blocks the save keeps in core/html blocks. */
	lifted?: string[];
}

/** What saving through the editor changes, for a note. */
export function describeEditorSave( result: MarkupValidation, fixes: string ): string[] {
	return [
		result.invalidBlocks ? `fixes ${ result.invalidBlocks } block(s)${ fixes }` : undefined,
		result.droppedComments
			? `drops ${ result.droppedComments } HTML comment(s) between blocks, which the editor would turn into Classic blocks (normalizeRawBlock in @wordpress/blocks wraps text outside a block in paragraphs) and which render nothing`
			: undefined,
		result.paletteColors?.length
			? describeStored(
					result.paletteColors.map(
						( { color, slug } ) => `${ color } as the palette's ${ slug }`
					),
					'a palette color (encodeColorValueWithPalette in @wordpress/block-editor), so it follows the palette'
			  )
			: undefined,
		result.fontSizes?.length
			? describeStored(
					result.fontSizes.map( ( { size, slug } ) => `${ size } as the font size ${ slug }` ),
					'a font size preset (getFontSizeObjectByValue in @wordpress/block-editor), so it follows the preset'
			  )
			: undefined,
		result.spacingSizes?.length
			? describeStored(
					result.spacingSizes.map(
						( { size, slug } ) => `${ size } as the spacing size ${ slug }`
					),
					'a spacing size preset (getPresetValueFromCustomValue in @wordpress/block-editor), so it follows the preset'
			  )
			: undefined,
		result.boundLinks?.length ? describeBoundLinks( result.boundLinks ) : undefined,
		...new Set(
			( result.lifted ?? [] ).map(
				( blockName ) =>
					`keeps the text written beside the inner blocks of ${ blockName } as a core/html block`
			)
		),
	].filter( ( note ): note is string => Boolean( note ) );
}

/**
 * What the editor's save corrects in the comment attributes, as sentences
 * of their own that end the one naming the save.
 */
export function describeCorrections( result: MarkupValidation ): string {
	return result.corrections?.length ? `. ${ result.corrections.join( ' ' ) }` : '';
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
	const named = ( blocks: string[] ) => boundedText( blocks, MAX_SAVING_BLOCKS );
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

/** What the editor's save changed besides the blocks it fixes, for a note. */
type StoredNotes = Pick<
	MarkupValidation,
	'droppedComments' | 'paletteColors' | 'fontSizes' | 'spacingSizes' | 'boundLinks'
>;
type StoredMarkup = { content: string; changed: boolean } & StoredNotes;

/**
 * What the editor stores for the markup: comments between blocks dropped, palette
 * colors as presets, entity links bound. `invalidBefore` counts the problems in
 * the content it replaces.
 */
async function storeAsTheEditorDoes(
	content: string,
	siteUrl: string,
	presetValues: PresetValues,
	editor: BlockEditor,
	invalidBefore: () => Promise< number >
): Promise< StoredMarkup > {
	const between = dropCommentsBetweenBlocks( content );
	const presets = await storePresetValues( between.content, siteUrl, presetValues, editor );
	const bound = await bindNavigationLinks( presets.content, siteUrl, editor );
	const notes: StoredNotes = {
		...( between.comments && { droppedComments: between.comments } ),
		...( presets.colors.length && { paletteColors: presets.colors } ),
		...( presets.fontSizes.length && { fontSizes: presets.fontSizes } ),
		...( presets.spacingSizes.length && { spacingSizes: presets.spacingSizes } ),
		...( bound.links.length && { boundLinks: bound.links } ),
	};
	const stored = {
		content: bound.content,
		changed: Object.keys( notes ).length > 0,
		...notes,
	};
	// A save stands only when the editor finds no more problems in it than in
	// what it replaces, whatever the pass that changed it.
	if (
		stored.changed &&
		( await validateBlocks( stored.content, siteUrl, editor ) ).invalidBlocks >
			( await invalidBefore() )
	) {
		return { content, changed: false };
	}
	return stored;
}

/** How the editor stores values written as presets (`each`, how it stores them), for a note. */
function describeStored( each: string[], how: string ): string {
	return `stores ${ [ ...new Set( each ) ].join( ', ' ) }, as the editor stores ${ how }`;
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
		presetValues,
		blockEditorOf( { file: filePath } )
	);
	if ( result.fixedContent === undefined ) {
		return { contentHash: hash( content ), summary: result.summary, problem: result.problem };
	}
	const notes = describeEditorSave( result, '' );
	return {
		contentHash: hash( content ),
		summary: `${ result.summary }; saved through the block editor, which ${ notes.join(
			' and '
		) }${ describeCorrections( result ) }`,
		...( result.problem && { problem: result.problem } ),
		fixedContent: ( pattern?.header ?? '' ) + result.fixedContent,
	};
}

/**
 * The blocks WordPress's block parser does not close with their own closer. It
 * closes the innermost open block at any closer, whatever its name, and at the
 * end of the content gives each block still open the rest of the content
 * (WP_Block_Parser::add_block_from_stack()), so the page renders that rest once
 * for each, and the editor saves it so.
 */
function unclosedBlocks( content: string ): string[] {
	const lineAt = ( offset: number ) => content.slice( 0, offset ).split( '\n' ).length;
	const delimiters = [ ...content.matchAll( BLOCK_DELIMITER ) ];
	// The line of the closer the parser closes each block at, by the offset of its opener.
	const parsedEnd = new Map< number, number >();
	const parsing: number[] = [];
	for ( const match of delimiters ) {
		const [ , closer, , , , , isVoid ] = match;
		if ( isVoid ) {
			continue;
		}
		if ( closer ) {
			const opener = parsing.pop();
			if ( opener !== undefined ) {
				parsedEnd.set( opener, lineAt( match.index ) );
			}
		} else {
			parsing.push( match.index );
		}
	}
	const open: { name: string; line: number; offset: number }[] = [];
	const problems: string[] = [];
	for ( const match of delimiters ) {
		const [ , closer, namespace = 'core/', name, , , isVoid ] = match;
		const block = {
			name: `${ namespace }${ name }`,
			line: lineAt( match.index ),
			offset: match.index,
		};
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
		// The outermost block around them, which the parser closes later too when
		// they took the closer of a block around them.
		const outer = at !== -1 ? open[ 0 ] : undefined;
		open.length = at === -1 ? Math.max( 0, open.length - 1 ) : at;
		const later = unclosed.length === 1 ? 'one closer later' : `${ unclosed.length } closers later`;
		const holds =
			outer &&
			`, and each block around it ${ later }: the ${ outer.name } opened on line ${
				outer.line
			} holds ${
				parsedEnd.has( outer.offset )
					? `everything to line ${ parsedEnd.get( outer.offset ) }`
					: 'the rest of the content'
			}`;
		problems.push(
			...unclosed.map(
				( opened ) =>
					`  - line ${ opened.line }: ${
						opened.name
					} has no closer of its own, so the parser closes it at the ${
						block.name
					} closer on line ${ block.line }${ holds ?? '' }`
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

/**
 * Validates block markup against what each block saves on the site, and
 * against the core/html policy. A lossless editor fix is returned for the
 * caller to save where the markup lives, whatever the policy finds.
 */
export async function validateBlockMarkup(
	content: string,
	label: string,
	siteUrl: string,
	presetValues: PresetValues = NO_PRESETS,
	editor: BlockEditor = 'post'
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
	const unknown = unknownPresetsProblem( content, label, presetValues );
	const result = await validateSavedMarkup( content, label, siteUrl, presetValues, editor );
	const problems = [ policy, unknown, result.problem ].filter( Boolean );
	return policy || unknown
		? {
				...result,
				summary: [
					result.summary,
					policy && 'core/html policy failed',
					unknown && 'names presets the site does not have',
				]
					.filter( Boolean )
					.join( '; ' ),
				problem: problems.join( '\n' ),
		  }
		: result;
}

// The presets a block can name, by the attribute or `var:preset|<kind>|` that
// names it. An attribute's value is the block's own style at the path given,
// where its style sets one, as a block support renders it inline.
const PRESET_KINDS: Array< {
	kind: keyof PresetValues;
	name: string;
	attributes: Record< string, string | undefined >;
	variable: string;
} > = [
	{
		kind: 'colors',
		name: 'color',
		attributes: {
			textColor: 'color.text',
			backgroundColor: 'color.background',
			borderColor: 'border.color',
			overlayColor: undefined,
		},
		variable: 'color',
	},
	{
		kind: 'fontSizes',
		name: 'font size',
		attributes: { fontSize: 'typography.fontSize' },
		variable: 'font-size',
	},
	{ kind: 'spacingSizes', name: 'spacing size', attributes: {}, variable: 'spacing' },
];

const BLOCK_OPENER = /<!--\s+wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)\s+(\{.*?\})\s+\/?-->/g;

function styleAt( style: unknown, at: string ): unknown {
	return at
		.split( '.' )
		.reduce< unknown >(
			( value, key ) =>
				value && typeof value === 'object'
					? ( value as Record< string, unknown > )[ key ]
					: undefined,
			style
		);
}

/**
 * The blocks that name a preset the site does not have. WordPress outputs a
 * preset's class and CSS variable only for the presets its settings resolve
 * (WP_Theme_JSON::get_preset_classes() and compute_preset_vars() in
 * wp-includes/class-wp-theme-json.php), so such a block shows the value it
 * inherits. A kind the site's presets were not read for is left out.
 */
function unknownPresetsProblem(
	content: string,
	label: string,
	presets: PresetValues
): string | undefined {
	const found: string[] = [];
	const kinds = new Set< ( typeof PRESET_KINDS )[ number ] >();
	for ( const match of content.matchAll( BLOCK_OPENER ) ) {
		let attrs: Record< string, unknown >;
		try {
			attrs = JSON.parse( match[ 2 ] );
		} catch {
			continue;
		}
		const json = JSON.stringify( attrs.style ?? {} );
		for ( const preset of PRESET_KINDS ) {
			const known = new Set( presets[ preset.kind ].map( ( [ slug ] ) => slug ) );
			if ( ! known.size ) {
				continue;
			}
			const named = [
				...Object.entries( preset.attributes )
					.filter( ( [ , style ] ) => ! style || styleAt( attrs.style, style ) === undefined )
					.map( ( [ attribute ] ) => attrs[ attribute ] ),
				...[
					...json.matchAll( new RegExp( `var:preset\\|${ preset.variable }\\|([^"|]+)`, 'g' ) ),
				].map( ( [ , slug ] ) => slug ),
			].filter( ( slug ): slug is string => typeof slug === 'string' && ! known.has( slug ) );
			for ( const slug of new Set( named ) ) {
				const line = content.slice( 0, match.index ).split( '\n' ).length;
				const block = match[ 1 ].includes( '/' ) ? match[ 1 ] : `core/${ match[ 1 ] }`;
				found.push( `  - line ${ line }: ${ block } ${ preset.name } ${ slug }` );
				kinds.add( preset );
			}
		}
	}
	if ( ! found.length ) {
		return undefined;
	}
	return [
		`${ label }: ${ found.length } preset(s) named that the site does not have, so WordPress outputs no class or CSS variable for them and each block shows the value it inherits (WP_Theme_JSON::get_preset_classes() and compute_preset_vars() in wp-includes/class-wp-theme-json.php):`,
		...found,
		...[ ...kinds ].map(
			( { kind, name } ) =>
				`The site's ${ name } presets (wp_get_global_settings()): ${ presets[ kind ]
					.map( ( [ slug, value ] ) => `${ slug } ${ value }` )
					.join( ', ' ) }. A block names one of them or sets its own value.`
		),
	].join( '\n' );
}

async function validateSavedMarkup(
	content: string,
	label: string,
	siteUrl: string,
	presetValues: PresetValues,
	editor: BlockEditor
): Promise< MarkupValidation > {
	// The editor's fix is saved without the comments between blocks, which it
	// would otherwise count as Classic blocks it cannot fix.
	const between = dropCommentsBetweenBlocks( content );
	const report = await validateBlocks( between.content, siteUrl, editor );
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
		} = await storeAsTheEditorDoes( content, siteUrl, presetValues, editor, async () => 0 );
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

	// A block stays as written when the fix loses something from it; the
	// editor's fix is saved for the rest, the blocks inside it too.
	const lost = new Map( fix.losses.map( ( loss ) => [ loss.place, loss.lost ] ) );
	const keptAsWritten = ( place = '' ) => lost.has( place );
	const fixedBlocks = report.results.filter(
		( result ) => ! result.isValid && ! keptAsWritten( result.place )
	).length;
	const stored = fixedBlocks
		? await storeAsTheEditorDoes( fix.fixedContent, siteUrl, presetValues, editor, async () =>
				lost.size ? ( await validateBlocks( fix.fixedContent, siteUrl, editor ) ).invalidBlocks : 0
		  )
		: undefined;
	// The comments between blocks were dropped before the fix, from the content written.
	const {
		content: fixedContent,
		changed,
		droppedComments,
		...notes
	}: Partial< StoredMarkup > = stored ?? {};
	const saved = stored && {
		fixedContent,
		invalidBlocks: fixedBlocks,
		corrections: [
			...new Set(
				report.results
					.filter( ( result ) => ! result.isValid && ! keptAsWritten( result.place ) )
					.flatMap( ( result ) => result.attributeIssues ?? [] )
			),
		],
		...notes,
		...( between.comments && { droppedComments: between.comments } ),
		...( fix.lift && { lifted: fix.lift.from } ),
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
	// The content whose validation the open problems last recorded.
	recorded?: string;
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
	 * run writes, whose text a saved fix would change under it. With `mine`,
	 * settles only the files it holds, as those of the agent calling, which
	 * the agents writing the others hear about from their own calls.
	 */
	async settle( {
		ready = false,
		except,
		mine = () => true,
	}: { ready?: boolean; except?: string; mine?: ( file: string ) => boolean } = {} ): Promise< {
		summaries: string[];
		problems: string[];
		saved: string[];
	} > {
		const summaries: string[] = [];
		const problems: string[] = [];
		const saved: string[] = [];
		for ( const [ filePath, tracked ] of this.files ) {
			if ( ! mine( filePath ) ) {
				continue;
			}
			if ( ready && ( filePath === except || ! ( await isCurrent( filePath, tracked ) ) ) ) {
				continue;
			}
			const result = await this.current( filePath, tracked.siteRoot ).then(
				( current ) => current && this.applyFix( filePath, current, saved )
			);
			this.open?.record(
				tracked.siteRoot,
				filePath,
				result?.problem,
				result !== undefined && result.contentHash !== tracked.recorded
			);
			tracked.recorded = result?.contentHash;
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
