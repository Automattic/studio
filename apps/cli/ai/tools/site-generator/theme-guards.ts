/**
 * Deterministic theme-markup guards for the wordpress-site-generator.
 *
 * Two failure classes the generator can ship that the identifier contract does
 * not cover:
 *
 *  - UNRESOLVABLE LOCAL FONT FILES — `theme.json` carrying `fontFace.src`
 *    `file:` paths to woff2 files the theme never bundles. Google Fonts are
 *    allowed; the generated theme can enqueue them from the declared families.
 *
 *  - RUNAWAY ARCHIVE LOOPS — a Query Loop with `wp:post-content` inside its
 *    `wp:post-template` (renders every entry's full body), an unbounded/absent
 *    `perPage`, or a nested same-block query. These cascade into multi-thousand-
 *    pixel pages. (Telex `query-loops.md`: never `wp:post-content` in a loop,
 *    always a finite perPage, one loop or sibling-offset, never nested.)
 */

const UNRESOLVABLE_FONT_SRC = /file:/i;

function srcIsUnresolvable( src: unknown ): boolean {
	if ( typeof src === 'string' ) {
		return UNRESOLVABLE_FONT_SRC.test( src );
	}
	if ( Array.isArray( src ) ) {
		return src.some(
			( entry ) => typeof entry === 'string' && UNRESOLVABLE_FONT_SRC.test( entry )
		);
	}
	return false;
}

/**
 * Remove `fontFace` arrays from `theme.json` whose `src` points at a `file:`
 * path, leaving the `fontFamily` CSS stack. Returns the rewritten JSON and the
 * slugs/names of the families whose fontFace was dropped.
 *
 * On unparseable input it returns the string unchanged (best-effort; the prompt
 * is the primary guard).
 */
export function stripUnresolvableFontFaces( themeJson: string ): {
	json: string;
	stripped: string[];
} {
	let parsed: Record< string, unknown >;
	try {
		parsed = JSON.parse( themeJson ) as Record< string, unknown >;
	} catch {
		return { json: themeJson, stripped: [] };
	}

	const families = (
		( parsed.settings as Record< string, unknown > | undefined )?.typography as
			| Record< string, unknown >
			| undefined
	 )?.fontFamilies;

	if ( ! Array.isArray( families ) ) {
		return { json: themeJson, stripped: [] };
	}

	const stripped: string[] = [];
	for ( const family of families ) {
		if ( ! family || typeof family !== 'object' ) {
			continue;
		}
		const record = family as Record< string, unknown >;
		const faces = record.fontFace;
		if ( ! Array.isArray( faces ) ) {
			continue;
		}
		if (
			faces.some( ( face ) => srcIsUnresolvable( ( face as Record< string, unknown > )?.src ) )
		) {
			delete record.fontFace;
			const id = record.slug ?? record.name;
			stripped.push( typeof id === 'string' ? id : JSON.stringify( id ) );
		}
	}

	if ( stripped.length === 0 ) {
		return { json: themeJson, stripped: [] };
	}
	return { json: JSON.stringify( parsed, null, '\t' ), stripped };
}

/** @deprecated Use stripUnresolvableFontFaces. */
export const stripRemoteFontFaces = stripUnresolvableFontFaces;

function parseThemeJsonOrThrow( themeJson: string ): Record< string, unknown > {
	try {
		return JSON.parse( themeJson ) as Record< string, unknown >;
	} catch ( error ) {
		const message = error instanceof Error ? error.message : String( error );
		throw new Error( `Generated theme.json is invalid JSON: ${ message }` );
	}
}

/**
 * Validate generated `theme.json` before it can be handed to downstream
 * generators or written to disk. This catches token-limit truncation at the
 * generator boundary instead of letting WordPress or a later repair pass
 * discover a corrupt file.
 */
export function normalizeGeneratedThemeJson( themeJson: string ): {
	json: string;
	stripped: string[];
} {
	parseThemeJsonOrThrow( themeJson );
	const normalized = stripUnresolvableFontFaces( themeJson );
	parseThemeJsonOrThrow( normalized.json );
	return normalized;
}

function blockNameFromCommentBody( body: string, prefix: string ): string {
	return body
		.slice( prefix.length )
		.trim()
		.split( /\s+|\// )[ 0 ];
}

/**
 * Validate generated post_content before seeding. This intentionally checks the
 * cheap structural failures caused by output truncation rather than attempting
 * full block validation: a dangling comment/tag, no WordPress block delimiter,
 * or unclosed block pair means the response was not a complete artifact.
 */
export function assertCompleteBlockMarkup(
	markup: string,
	label = 'Generated block markup'
): void {
	const trimmed = markup.trim();
	if ( ! trimmed ) {
		throw new Error( `${ label } is empty.` );
	}
	if ( ! /<!--\s*wp:/i.test( trimmed ) ) {
		throw new Error( `${ label } contains no WordPress block delimiters.` );
	}

	let lastCommentEnd = 0;
	const stack: string[] = [];
	const commentRegex = /<!--([\s\S]*?)-->/g;
	let match: RegExpExecArray | null;
	while ( ( match = commentRegex.exec( trimmed ) ) ) {
		lastCommentEnd = commentRegex.lastIndex;
		const body = match[ 1 ].trim();
		if ( body.startsWith( 'wp:' ) ) {
			if ( body.endsWith( '/' ) ) {
				continue;
			}
			stack.push( blockNameFromCommentBody( body, 'wp:' ) );
		} else if ( body.startsWith( '/wp:' ) ) {
			const closing = blockNameFromCommentBody( body, '/wp:' );
			const opening = stack.pop();
			if ( opening !== closing ) {
				throw new Error(
					`${ label } has mismatched WordPress blocks: expected ${
						opening ? `/${ opening }` : 'no closing block'
					}, got /${ closing }.`
				);
			}
		}
	}

	if ( trimmed.slice( lastCommentEnd ).includes( '<!--' ) ) {
		throw new Error( `${ label } has an unterminated HTML comment.` );
	}
	if ( /<[^>]*$/.test( trimmed ) ) {
		throw new Error( `${ label } ends inside an HTML tag.` );
	}
	if ( stack.length > 0 ) {
		throw new Error(
			`${ label } has unclosed WordPress block(s): ${ stack.slice( -3 ).join( ', ' ) }.`
		);
	}
}

export interface ThemeTokenViolation {
	file: string;
	type: 'color' | 'font-family' | 'font-size' | 'spacing' | 'gradient' | 'duotone';
	slug: string;
	detail: string;
}

interface ThemeTokenSets {
	color: Set< string >;
	fontFamily: Set< string >;
	fontSize: Set< string >;
	spacing: Set< string >;
	gradient: Set< string >;
	duotone: Set< string >;
}

function slugSet( items: unknown ): Set< string > {
	const out = new Set< string >();
	if ( ! Array.isArray( items ) ) {
		return out;
	}
	for ( const item of items ) {
		const slug = ( item as { slug?: unknown } )?.slug;
		if ( typeof slug === 'string' && slug.trim() ) {
			out.add( slug.trim() );
		}
	}
	return out;
}

function collectThemeTokenSets( themeJson: string ): ThemeTokenSets | null {
	let parsed: Record< string, unknown >;
	try {
		parsed = JSON.parse( themeJson ) as Record< string, unknown >;
	} catch {
		return null;
	}

	const settings = parsed.settings as Record< string, unknown > | undefined;
	const color = settings?.color as Record< string, unknown > | undefined;
	const typography = settings?.typography as Record< string, unknown > | undefined;
	const spacing = settings?.spacing as Record< string, unknown > | undefined;

	return {
		color: slugSet( color?.palette ),
		gradient: slugSet( color?.gradients ),
		duotone: slugSet( color?.duotone ),
		fontFamily: slugSet( typography?.fontFamilies ),
		fontSize: slugSet( typography?.fontSizes ),
		spacing: slugSet( spacing?.spacingSizes ),
	};
}

function addViolation(
	violations: ThemeTokenViolation[],
	seen: Set< string >,
	file: string,
	type: ThemeTokenViolation[ 'type' ],
	slug: string,
	allowed: Set< string >,
	source: string
): void {
	if ( ! /^[a-z0-9-]+$/.test( slug ) ) {
		return;
	}
	if ( allowed.has( slug ) ) {
		return;
	}
	const key = `${ file }\0${ type }\0${ slug }\0${ source }`;
	if ( seen.has( key ) ) {
		return;
	}
	seen.add( key );
	violations.push( {
		file,
		type,
		slug,
		detail: `${ source } references '${ slug }', but theme.json does not declare that ${ type } slug.`,
	} );
}

function scanRegex(
	content: string,
	regex: RegExp,
	callback: ( match: RegExpExecArray ) => void
): void {
	let match: RegExpExecArray | null;
	while ( ( match = regex.exec( content ) ) ) {
		callback( match );
	}
}

/**
 * Find generated CSS/block markup that references palette, typography, or
 * spacing slugs not declared in the generated theme.json. This catches the
 * high-impact drift where parallel calls invent their own vocabulary
 * (`has-cobalt-background-color` while theme.json only declares `primary`).
 */
export function findThemeTokenReferenceViolations(
	themeJson: string,
	files: Array< { rel: string; content: string } >
): ThemeTokenViolation[] {
	const tokens = collectThemeTokenSets( themeJson );
	if ( ! tokens ) {
		return [];
	}

	const violations: ThemeTokenViolation[] = [];
	const seen = new Set< string >();

	for ( const file of files ) {
		if ( file.rel === 'theme.json' ) {
			continue;
		}
		const content = file.content;

		scanRegex(
			content,
			/\bhas-([a-z0-9-]+?)-(background-color|border-color|color)\b/g,
			( match ) => {
				if (
					match[ 0 ] === 'has-text-color' ||
					match[ 0 ] === 'has-background-color' ||
					match[ 0 ] === 'has-border-color'
				) {
					return;
				}
				addViolation(
					violations,
					seen,
					file.rel,
					'color',
					match[ 1 ],
					tokens.color,
					`class ${ match[ 0 ] }`
				);
			}
		);
		scanRegex(
			content,
			/"(?:backgroundColor|textColor|borderColor)"\s*:\s*"([^"]+)"/g,
			( match ) => {
				addViolation(
					violations,
					seen,
					file.rel,
					'color',
					match[ 1 ],
					tokens.color,
					'block color attribute'
				);
			}
		);
		scanRegex( content, /var:preset\|color\|([a-z0-9-]+)/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'color',
				match[ 1 ],
				tokens.color,
				'var:preset color reference'
			);
		} );
		scanRegex( content, /--wp--preset--color--([a-z0-9-]+)/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'color',
				match[ 1 ],
				tokens.color,
				'CSS color custom property'
			);
		} );
		scanRegex( content, /"gradient"\s*:\s*"([^"]+)"/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'gradient',
				match[ 1 ],
				tokens.gradient,
				'block gradient attribute'
			);
		} );
		scanRegex( content, /\bhas-([a-z0-9-]+)-gradient-background\b/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'gradient',
				match[ 1 ],
				tokens.gradient,
				`class ${ match[ 0 ] }`
			);
		} );
		scanRegex( content, /\bwp-duotone-([a-z0-9-]+)\b/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'duotone',
				match[ 1 ],
				tokens.duotone,
				`class ${ match[ 0 ] }`
			);
		} );
		scanRegex( content, /"fontFamily"\s*:\s*"([^"]+)"/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'font-family',
				match[ 1 ],
				tokens.fontFamily,
				'block fontFamily attribute'
			);
		} );
		scanRegex( content, /var:preset\|font-family\|([a-z0-9-]+)/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'font-family',
				match[ 1 ],
				tokens.fontFamily,
				'var:preset font-family reference'
			);
		} );
		scanRegex( content, /--wp--preset--font-family--([a-z0-9-]+)/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'font-family',
				match[ 1 ],
				tokens.fontFamily,
				'CSS font-family custom property'
			);
		} );
		scanRegex( content, /\bhas-([a-z0-9-]+)-font-family\b/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'font-family',
				match[ 1 ],
				tokens.fontFamily,
				`class ${ match[ 0 ] }`
			);
		} );
		scanRegex( content, /"fontSize"\s*:\s*"([^"]+)"/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'font-size',
				match[ 1 ],
				tokens.fontSize,
				'block fontSize attribute'
			);
		} );
		scanRegex( content, /var:preset\|font-size\|([a-z0-9-]+)/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'font-size',
				match[ 1 ],
				tokens.fontSize,
				'var:preset font-size reference'
			);
		} );
		scanRegex( content, /--wp--preset--font-size--([a-z0-9-]+)/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'font-size',
				match[ 1 ],
				tokens.fontSize,
				'CSS font-size custom property'
			);
		} );
		scanRegex( content, /\bhas-([a-z0-9-]+)-font-size\b/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'font-size',
				match[ 1 ],
				tokens.fontSize,
				`class ${ match[ 0 ] }`
			);
		} );
		scanRegex( content, /var:preset\|spacing\|([a-z0-9-]+)/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'spacing',
				match[ 1 ],
				tokens.spacing,
				'var:preset spacing reference'
			);
		} );
		scanRegex( content, /--wp--preset--spacing--([a-z0-9-]+)/g, ( match ) => {
			addViolation(
				violations,
				seen,
				file.rel,
				'spacing',
				match[ 1 ],
				tokens.spacing,
				'CSS spacing custom property'
			);
		} );
	}

	return violations;
}

export interface ArchiveLoopViolation {
	code:
		| 'post-content-in-post-template'
		| 'nested-query-in-post-template'
		| 'unbounded-perpage'
		| 'missing-perpage';
	detail: string;
}

const POST_TEMPLATE_OPEN = /<!--\s*wp:post-template\b[^>]*-->/gi;
const POST_TEMPLATE_CLOSE = '<!-- /wp:post-template -->';

// The inner regions of every `wp:post-template … /wp:post-template` pair, scanned
// sequentially (post-template blocks are not nested in themselves).
function postTemplateInners( html: string ): string[] {
	const inners: string[] = [];
	let cursor = 0;
	for (;;) {
		POST_TEMPLATE_OPEN.lastIndex = cursor;
		const open = POST_TEMPLATE_OPEN.exec( html );
		if ( ! open ) {
			break;
		}
		const innerStart = open.index + open[ 0 ].length;
		const closeAt = html.indexOf( POST_TEMPLATE_CLOSE, innerStart );
		if ( closeAt === -1 ) {
			break;
		}
		inners.push( html.slice( innerStart, closeAt ) );
		cursor = closeAt + POST_TEMPLATE_CLOSE.length;
	}
	return inners;
}

// The parsed attribute object of every `wp:query` block (balanced-brace scan of
// the JSON that follows the block name).
function queryAttrs( html: string ): Array< Record< string, unknown > > {
	const out: Array< Record< string, unknown > > = [];
	const re = /<!--\s*wp:query\s*\{/gi;
	let match: RegExpExecArray | null;
	while ( ( match = re.exec( html ) ) ) {
		const braceStart = match.index + match[ 0 ].length - 1;
		let depth = 0;
		let i = braceStart;
		for ( ; i < html.length; i++ ) {
			if ( html[ i ] === '{' ) {
				depth++;
			} else if ( html[ i ] === '}' ) {
				depth--;
				if ( depth === 0 ) {
					i++;
					break;
				}
			}
		}
		try {
			out.push( JSON.parse( html.slice( braceStart, i ) ) as Record< string, unknown > );
		} catch {
			/* unparseable attrs — skip */
		}
	}
	return out;
}

/**
 * Observational lint for runaway-archive-loop shapes. Returns the violations
 * found (empty for a bounded, primitive-only, single-or-sibling loop). The
 * featured+rest idiom (two sibling queries, each bounded) passes.
 */
export function findArchiveLoopViolations( html: string ): ArchiveLoopViolation[] {
	const violations: ArchiveLoopViolation[] = [];

	for ( const inner of postTemplateInners( html ) ) {
		if ( /<!--\s*wp:post-content\b/i.test( inner ) ) {
			violations.push( {
				code: 'post-content-in-post-template',
				detail: "wp:post-content inside a post-template renders every entry's full body",
			} );
		}
		if ( /<!--\s*wp:query\b/i.test( inner ) ) {
			violations.push( {
				code: 'nested-query-in-post-template',
				detail: 'a nested wp:query inside a post-template multiplies entries (N×N)',
			} );
		}
	}

	for ( const attrs of queryAttrs( html ) ) {
		const query = attrs.query as Record< string, unknown > | undefined;
		if ( ! query ) {
			continue;
		}
		if ( query.perPage === -1 ) {
			violations.push( {
				code: 'unbounded-perpage',
				detail: 'wp:query perPage:-1 renders the entire collection',
			} );
		} else if ( query.perPage === undefined && typeof query.postType === 'string' ) {
			violations.push( {
				code: 'missing-perpage',
				detail: `wp:query for '${ query.postType }' has no finite perPage cap`,
			} );
		}
	}

	return violations;
}
