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

export interface IdentifierContract {
	prefix: string;
	restNamespace: string;
	blockSlugs: string[];
	blockNames: string[];
	cptKeys: string[];
}

export interface ContractManifestInput {
	themePrefix: string;
	companionPlugin: {
		blocks: Array< { slug: string } >;
		postTypes: Array< { slug: string } >;
	};
}

export interface MarkupRewrite {
	kind: 'block' | 'postType';
	from: string;
	to: string;
}

export type ViolationType =
	| 'prefix_mismatch'
	| 'unknown_block_reference'
	| 'unknown_post_type_reference'
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

	return violations;
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
