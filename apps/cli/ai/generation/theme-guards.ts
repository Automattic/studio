/**
 * Deterministic theme-markup guards for the wordpress-site-generator.
 *
 * Two failure classes the generator can ship that the identifier contract does
 * not cover:
 *
 *  - REMOTE FONTS — `theme.json` carrying `fontFace.src` URLs (Google's
 *    `fonts.gstatic.com` CDN, or `file:` paths to woff2 the theme never bundles).
 *    They fail in headless/offline/CSP environments. Telex keeps theme.json
 *    typography to design tokens only; Studio ships no fonts.php and no font
 *    binaries, so the only resolvable form is a system-font CSS stack.
 *
 *  - RUNAWAY ARCHIVE LOOPS — a Query Loop with `wp:post-content` inside its
 *    `wp:post-template` (renders every entry's full body), an unbounded/absent
 *    `perPage`, or a nested same-block query. These cascade into multi-thousand-
 *    pixel pages. (Telex `query-loops.md`: never `wp:post-content` in a loop,
 *    always a finite perPage, one loop or sibling-offset, never nested.)
 */

const REMOTE_FONT_SRC = /gstatic\.com|googleapis\.com|https?:\/\/|file:/i;

function srcIsUnresolvable( src: unknown ): boolean {
	if ( typeof src === 'string' ) {
		return REMOTE_FONT_SRC.test( src );
	}
	if ( Array.isArray( src ) ) {
		return src.some( ( entry ) => typeof entry === 'string' && REMOTE_FONT_SRC.test( entry ) );
	}
	return false;
}

/**
 * Remove `fontFace` arrays from `theme.json` whose `src` points at a remote CDN
 * or a `file:` path (no font binaries are generated), leaving the `fontFamily`
 * CSS stack — which renders with system fonts and needs no network. Returns the
 * rewritten JSON and the slugs/names of the families whose fontFace was dropped.
 * On unparseable input it returns the string unchanged (best-effort; the prompt
 * is the primary guard).
 */
export function stripRemoteFontFaces( themeJson: string ): { json: string; stripped: string[] } {
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
