/**
 * Identifier contract for the wordpress-site-generator.
 *
 * WordPress requires EXACT string matches between where a custom post type or
 * custom block is registered and everywhere it is referenced (Query Loop
 * `postType`, `<!-- wp:ns/slug -->`, `archive-<key>.html`). The generation
 * pipeline produces those references from independent LLM calls, which drift
 * (e.g. a block registered `acme-functionality/acme-form` referenced as
 * `acme/form`; a CPT registered `acme_dish` queried as `dish`).
 *
 * Adapted from Telex: a single canonical `themePrefix` pins every identifier —
 * blocks are `{prefix}/{slug}`, CPTs are `{prefix}_{suffix}` (<=20 chars),
 * REST is `{prefix}/v1`. This module derives that contract from the manifest,
 * then RECONCILES generated markup to it deterministically, and VALIDATES that
 * nothing unresolvable remains. (Telex `FoundationPromptBuilder::derivePrefixFromSlug`
 * + `ArtefactSemanticValidator`.)
 */

// register_post_type() silently fails above 20 chars.
const CPT_SLUG_MAX_LENGTH = 20;

// Core/built-in post types a Query Loop may legitimately target.
const CORE_POST_TYPES = new Set( [
	'post',
	'page',
	'attachment',
	'any',
	'nav_menu_item',
	'wp_block',
	'wp_template',
	'wp_template_part',
	'wp_navigation',
] );

// Core/built-in taxonomies a Query Loop may legitimately filter on.
const CORE_TAXONOMIES = new Set( [
	'category',
	'post_tag',
	'post_format',
	'nav_menu',
	'link_category',
] );

export interface IdentifierContract {
	prefix: string;
	restNamespace: string;
	blockSlugs: string[];
	blockNames: string[];
	cptKeys: string[];
	// Slugs of the pages seeded into the DB. A CPT archive/rewrite slug equal to
	// one of these shadows the page (WordPress routes the URL to the CPT archive),
	// so the plugin sanitizer neutralises any such collision.
	pageSlugs: string[];
	// Registered custom taxonomy keys a Query Loop `taxQuery` may legitimately
	// filter on. Empty in the Telex-aligned model (facets are post_meta, not
	// taxonomies); any taxQuery against a non-core, non-listed taxonomy is
	// stripped on reconcile and flagged on validate.
	taxKeys: string[];
}

export interface ContractManifestInput {
	themePrefix: string;
	pages?: Array< { slug: string } >;
	companionPlugin: {
		blocks: Array< { slug: string } >;
		postTypes: Array< { slug: string } >;
	};
}

export interface MarkupRewrite {
	kind: 'block' | 'postType' | 'taxonomy';
	from: string;
	to: string;
}

export type ViolationType =
	| 'prefix_mismatch'
	| 'unknown_block_reference'
	| 'unknown_post_type_reference'
	| 'unknown_taxonomy_reference'
	| 'cpt_archive_slug_collides_with_page'
	| 'block_name_mismatch'
	| 'cpt_slug_too_long';

export interface Violation {
	type: ViolationType;
	ref: string;
	detail: string;
}

/**
 * Deterministic theme prefix from a slug: first segment of length >= 3, else a
 * squashed fallback; lowercased, <=12 chars, never leading digits/underscores.
 * Returns 'theme' when nothing usable remains. (Port of Telex.)
 */
export function deriveThemePrefix( slug: string ): string {
	const cleaned = ( slug ?? '' )
		.toLowerCase()
		.trim()
		.replace( /[^a-z0-9_-]/g, '' );
	const segments = cleaned.split( /[-_]/ ).filter( Boolean );
	let candidate = segments.find( ( s ) => s.length >= 3 ) ?? '';
	if ( ! candidate ) {
		candidate = cleaned.replace( /-/g, '_' );
	}
	candidate = candidate
		.replace( /[^a-z0-9_]/g, '' )
		.replace( /^[_0-9]+/, '' )
		.slice( 0, 12 )
		.replace( /_+$/, '' );
	return candidate.length >= 3 ? candidate : 'theme';
}

function underscoreSuffix( source: string ): string {
	return source
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '_' )
		.replace( /^_+|_+$/g, '' );
}

/** Canonical CPT key `{prefix}_{suffix}`, capped at 20 chars, no double prefix. */
export function canonicalCptKey( prefix: string, source: string ): string {
	let suffix = underscoreSuffix( source );
	if ( suffix.startsWith( `${ prefix }_` ) ) {
		suffix = suffix.slice( prefix.length + 1 );
	}
	const maxSuffix = Math.max( 1, CPT_SLUG_MAX_LENGTH - prefix.length - 1 );
	if ( suffix.length > maxSuffix ) {
		suffix = suffix.slice( 0, maxSuffix ).replace( /_+$/, '' );
	}
	return `${ prefix }_${ suffix }`;
}

/** Canonical block slug (hyphenated), with a redundant leading `{prefix}-` stripped. */
export function canonicalBlockSlug( prefix: string, source: string ): string {
	let slug = source
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
	if ( slug.startsWith( `${ prefix }-` ) ) {
		slug = slug.slice( prefix.length + 1 );
	}
	return slug;
}

export function contractFromManifest( manifest: ContractManifestInput ): IdentifierContract {
	const prefix = manifest.themePrefix;
	const blockSlugs = manifest.companionPlugin.blocks.map( ( b ) => b.slug );
	return {
		prefix,
		restNamespace: `${ prefix }/v1`,
		blockSlugs,
		blockNames: blockSlugs.map( ( slug ) => `${ prefix }/${ slug }` ),
		cptKeys: manifest.companionPlugin.postTypes.map( ( p ) => p.slug ),
		pageSlugs: ( manifest.pages ?? [] ).map( ( p ) => p.slug ),
		// No custom taxonomies are modeled (facets are post_meta in the Telex-aligned
		// model). Threaded here so a future manifest taxonomy field can populate it
		// without touching the reconcile/validate call sites.
		taxKeys: [],
	};
}

export interface ContractVocabularyInput {
	themePrefix: string;
	companionPlugin: {
		blocks: Array< { slug: string; title?: string; purpose?: string } >;
		postTypes: Array< { slug: string; name?: string } >;
		restRoutes: Array< { path: string } >;
	};
}

/**
 * A prompt fragment that hands a generator the EXACT identifiers it must use,
 * so it references registered blocks/CPTs by their canonical names instead of
 * inventing its own (the failure that left blocks unrendered and Query Loops
 * pointed at non-existent post types). Threaded into the page-content,
 * template, block, and companion-plugin generators.
 */
export function contractVocabulary( input: ContractVocabularyInput ): string {
	const { themePrefix } = input;
	const lines = [
		'CANONICAL IDENTIFIERS — use these EXACT strings; never abbreviate, re-spell, or invent new ones:',
		`- Theme prefix: ${ themePrefix }`,
	];

	const blocks = input.companionPlugin.blocks;
	if ( blocks.length ) {
		lines.push( '- Custom blocks (embed as `<!-- wp:{name} /-->`, or with an inner-block pair):' );
		for ( const block of blocks ) {
			const name = `${ themePrefix }/${ block.slug }`;
			lines.push( `    - ${ name }${ block.purpose ? ` — ${ block.purpose }` : '' }` );
		}
	}

	const postTypes = input.companionPlugin.postTypes;
	if ( postTypes.length ) {
		lines.push(
			'- Custom post types (use the key VERBATIM as the `postType` in Query Loop blocks; do NOT invent friendly names):'
		);
		for ( const postType of postTypes ) {
			lines.push( `    - ${ postType.slug }${ postType.name ? ` (${ postType.name })` : '' }` );
		}
	}

	if ( input.companionPlugin.restRoutes.length ) {
		lines.push( `- REST namespace for form submissions: ${ themePrefix }/v1` );
	}

	return lines.join( '\n' );
}

// Opening custom-block delimiter `<!-- wp:<ns>/<slug>` (core blocks have no slash).
const blockRefRe = (): RegExp => /<!--\s*wp:([a-z][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)/gi;
// Query Loop postType attribute.
const postTypeRe = (): RegExp => /("postType"\s*:\s*")([a-z0-9_-]+)(")/gi;

/**
 * Locate each `"taxQuery":{...}` object in a markup string by a balanced-brace
 * scan (so nested term objects like `{"slug":"x"}` are handled), returning the
 * span that covers the `"taxQuery"` key through its closing brace plus the
 * top-level taxonomy keys it filters on.
 */
function findTaxQueries( html: string ): Array< { start: number; end: number; keys: string[] } > {
	const out: Array< { start: number; end: number; keys: string[] } > = [];
	const re = /"taxQuery"\s*:\s*\{/gi;
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
		let keys: string[] = [];
		try {
			keys = Object.keys( JSON.parse( html.slice( braceStart, i ) ) as Record< string, unknown > );
		} catch {
			keys = [];
		}
		out.push( { start: match.index, end: i, keys } );
	}
	return out;
}

function isKnownTaxonomy( key: string, contract: IdentifierContract ): boolean {
	return contract.taxKeys.includes( key ) || CORE_TAXONOMIES.has( key );
}

/**
 * Remove a `"taxQuery":{...}` span from a markup string, absorbing one adjacent
 * comma so the surrounding Query Loop JSON object stays well-formed.
 */
function stripTaxQuerySpan( html: string, start: number, end: number ): string {
	let from = start;
	let to = end;
	let i = start - 1;
	while ( i >= 0 && /\s/.test( html[ i ] ) ) {
		i--;
	}
	if ( html[ i ] === ',' ) {
		from = i;
	} else {
		let j = end;
		while ( j < html.length && /\s/.test( html[ j ] ) ) {
			j++;
		}
		if ( html[ j ] === ',' ) {
			to = j + 1;
		}
	}
	return html.slice( 0, from ) + html.slice( to );
}

/**
 * Map a drifted postType to a registered CPT key when unambiguous: exact after
 * hyphen->underscore normalisation, or a unique suffix match (the part after
 * the first underscore). Returns null when there is no safe single target.
 */
function matchCptBySuffix( type: string, cptKeys: string[] ): string | null {
	const norm = type.toLowerCase().replace( /-/g, '_' );
	if ( cptKeys.includes( norm ) ) {
		return norm;
	}
	const suffixOf = ( key: string ): string =>
		key.includes( '_' ) ? key.slice( key.indexOf( '_' ) + 1 ) : key;
	const wanted = suffixOf( norm );
	const matches = cptKeys.filter( ( key ) => suffixOf( key ) === wanted );
	return matches.length === 1 ? matches[ 0 ] : null;
}

/**
 * Rewrite drifted identifiers in a markup string to the canonical contract:
 * custom-block references to `{prefix}/{slug}` (when the slug is registered),
 * and Query Loop `postType` to the registered CPT key (when unambiguous).
 * Leaves unresolvable references untouched for `validateMarkup` to flag.
 */
export function reconcileMarkup(
	html: string,
	contract: IdentifierContract
): { html: string; rewrites: MarkupRewrite[] } {
	const rewrites: MarkupRewrite[] = [];

	let out = html.replace( blockRefRe(), ( full, ns: string, slug: string ) => {
		if ( contract.blockSlugs.includes( slug ) && ns !== contract.prefix ) {
			rewrites.push( {
				kind: 'block',
				from: `${ ns }/${ slug }`,
				to: `${ contract.prefix }/${ slug }`,
			} );
			return full.replace( `${ ns }/${ slug }`, `${ contract.prefix }/${ slug }` );
		}
		return full;
	} );

	out = out.replace( postTypeRe(), ( full, pre: string, type: string, post: string ) => {
		if ( contract.cptKeys.includes( type ) || CORE_POST_TYPES.has( type ) ) {
			return full;
		}
		const target = matchCptBySuffix( type, contract.cptKeys );
		if ( target ) {
			rewrites.push( { kind: 'postType', from: type, to: target } );
			return `${ pre }${ target }${ post }`;
		}
		return full;
	} );

	// Strip any `taxQuery` that filters on a taxonomy which is neither registered
	// nor core: the loop falls back to filtering by postType only, so it returns
	// the CPT's entries instead of an empty set. (Telex models facets as
	// post_meta, so a custom-taxonomy filter is always a dangling reference.)
	// Process spans last-to-first so earlier indices stay valid as we splice.
	const taxQueries = findTaxQueries( out );
	for ( let q = taxQueries.length - 1; q >= 0; q-- ) {
		const { start, end, keys } = taxQueries[ q ];
		const unknown = keys.filter( ( key ) => ! isKnownTaxonomy( key, contract ) );
		if ( unknown.length === 0 ) {
			continue;
		}
		for ( const key of unknown ) {
			rewrites.push( { kind: 'taxonomy', from: key, to: '' } );
		}
		out = stripTaxQuerySpan( out, start, end );
	}

	return { html: out, rewrites };
}

/** Residual violations after reconciliation: references that resolve to nothing registered. */
export function validateMarkup(
	html: string,
	contract: IdentifierContract,
	label?: string
): Violation[] {
	const where = label ? ` in ${ label }` : '';
	const violations: Violation[] = [];

	const seenBlocks = new Set< string >();
	for ( const match of html.matchAll( blockRefRe() ) ) {
		const ns = match[ 1 ];
		const slug = match[ 2 ];
		const ref = `${ ns }/${ slug }`;
		if ( seenBlocks.has( ref ) ) {
			continue;
		}
		seenBlocks.add( ref );
		if ( ns !== contract.prefix ) {
			violations.push( {
				type: 'prefix_mismatch',
				ref,
				detail: `block prefix '${ ns }' is not the theme prefix '${ contract.prefix }'${ where }`,
			} );
		} else if ( ! contract.blockSlugs.includes( slug ) ) {
			violations.push( {
				type: 'unknown_block_reference',
				ref,
				detail: `no custom block '${ slug }' is registered${ where }`,
			} );
		}
	}

	const seenTypes = new Set< string >();
	for ( const match of html.matchAll( postTypeRe() ) ) {
		const type = match[ 2 ];
		if ( seenTypes.has( type ) ) {
			continue;
		}
		seenTypes.add( type );
		if ( ! contract.cptKeys.includes( type ) && ! CORE_POST_TYPES.has( type ) ) {
			violations.push( {
				type: 'unknown_post_type_reference',
				ref: type,
				detail: `Query Loop postType '${ type }' is neither a registered CPT nor a core type${ where }`,
			} );
		}
	}

	const seenTax = new Set< string >();
	for ( const { keys } of findTaxQueries( html ) ) {
		for ( const key of keys ) {
			if ( seenTax.has( key ) || isKnownTaxonomy( key, contract ) ) {
				continue;
			}
			seenTax.add( key );
			violations.push( {
				type: 'unknown_taxonomy_reference',
				ref: key,
				detail: `Query Loop taxQuery '${ key }' is neither a registered custom taxonomy nor a core one${ where }`,
			} );
		}
	}

	return violations;
}

/**
 * Neutralise a CPT registration whose front-end URL base would shadow a content
 * page. `has_archive => '<page-slug>'` and `rewrite => array( 'slug' => '<page-slug>' )`
 * are rewritten to `true` (the default), which keys the archive/single base off
 * the theme-prefixed post-type key (e.g. `/untold_sponsors/`) so the page keeps
 * `/<page-slug>/`. Pages remain the canonical collection surface; archives stay
 * live but at a prefixed, collision-free URL. (Telex `functions.md`: never let an
 * unprefixed slug become the archive/rewrite base.) Idempotent.
 */
export function sanitizeCptArchiveSlugs(
	php: string,
	pageSlugs: string[]
): { php: string; violations: Violation[] } {
	const pages = new Set( pageSlugs );
	const violations: Violation[] = [];

	let out = php.replace(
		/(['"]has_archive['"]\s*=>\s*)(['"])([a-z0-9_-]+)\2/gi,
		( full, pre: string, _q: string, slug: string ) => {
			if ( ! pages.has( slug ) ) {
				return full;
			}
			violations.push( {
				type: 'cpt_archive_slug_collides_with_page',
				ref: slug,
				detail: `CPT has_archive slug '${ slug }' collides with a page; routed to the prefixed key instead`,
			} );
			return `${ pre }true`;
		}
	);

	out = out.replace(
		/(['"]rewrite['"]\s*=>\s*)array\(\s*['"]slug['"]\s*=>\s*(['"])([a-z0-9_-]+)\2[^)]*\)/gi,
		( full, pre: string, _q: string, slug: string ) => {
			if ( ! pages.has( slug ) ) {
				return full;
			}
			violations.push( {
				type: 'cpt_archive_slug_collides_with_page',
				ref: slug,
				detail: `CPT rewrite slug '${ slug }' collides with a page; using the prefixed key instead`,
			} );
			return `${ pre }true`;
		}
	);

	return { php: out, violations };
}

/**
 * Extract the literal taxonomy keys a plugin registers via `register_taxonomy()`.
 * Mirrors {@link findRegisteredPostTypes}; used to verify a taxonomy a Query Loop
 * filters on is actually registered. Returns [] when none are registered.
 */
export function findRegisteredTaxonomies( php: string ): string[] {
	const keys = new Set< string >();
	for ( const match of php.matchAll( /register_taxonomy\(\s*['"]([a-z0-9_-]+)['"]/gi ) ) {
		keys.add( match[ 1 ] );
	}
	return Array.from( keys );
}

/** Force a block.json `name` to `{prefix}/{slug}`. */
export function reconcileBlockJsonName(
	blockJson: string,
	slug: string,
	contract: IdentifierContract
): { json: string; changed: boolean } {
	let parsed: Record< string, unknown >;
	try {
		parsed = JSON.parse( blockJson ) as Record< string, unknown >;
	} catch {
		return { json: blockJson, changed: false };
	}
	const expected = `${ contract.prefix }/${ slug }`;
	if ( parsed.name === expected ) {
		return { json: blockJson, changed: false };
	}
	parsed.name = expected;
	return { json: JSON.stringify( parsed, null, '\t' ), changed: true };
}

/**
 * Extract the literal post-type keys a plugin registers via `register_post_type()`.
 * Used to verify the generated PHP actually registers the manifest's CPTs (a
 * mismatch orphans seeded entries even when content references are canonical).
 * Returns [] when registration is non-literal (e.g. a loop) — can't verify.
 */
export function findRegisteredPostTypes( php: string ): string[] {
	const keys = new Set< string >();
	for ( const match of php.matchAll( /register_post_type\(\s*['"]([a-z0-9_-]+)['"]/gi ) ) {
		keys.add( match[ 1 ] );
	}
	return Array.from( keys );
}

/** Contract-level check: CPT keys must fit register_post_type's 20-char limit. */
export function validateContract( contract: IdentifierContract ): Violation[] {
	return contract.cptKeys
		.filter( ( key ) => key.length > CPT_SLUG_MAX_LENGTH )
		.map( ( key ) => ( {
			type: 'cpt_slug_too_long' as const,
			ref: key,
			detail: `CPT key '${ key }' is ${ key.length } chars (max ${ CPT_SLUG_MAX_LENGTH })`,
		} ) );
}
