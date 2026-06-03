import { isIP } from 'node:net';

/**
 * Pure helpers for `fetch_webpage`: URL normalization, an SSRF guard, and a
 * dependency-free HTML → text-brief extractor.
 *
 * The agent fetches user/LLM-supplied URLs to brief itself on a referenced
 * site, so the guard matters even though Studio runs on the user's machine: a
 * crafted link could otherwise probe `localhost`, the loopback interface, or a
 * private LAN address. The guard rejects non-http(s) schemes, localhost,
 * single-label hosts, and private/reserved IP literals; the tool additionally
 * re-validates every redirect hop. Full DNS-pinning SSRF defense (resolving
 * the host and checking the resolved IP) is intentionally out of scope.
 */

/** Hard cap on bytes pulled from a target page (1 MB). */
export const MAX_BODY_BYTES = 1_000_000;
/** Read timeout for the fetch, in milliseconds. */
export const FETCH_TIMEOUT_MS = 10_000;
/** Max redirect hops to follow, each re-validated against `isFetchableUrl`. */
export const MAX_REDIRECTS = 4;
/** Cap on the extracted text brief handed back to the model. */
export const EXCERPT_MAX_CHARS = 6000;
/** Declares Studio and is easy for a site owner to block. */
export const USER_AGENT = 'WordPressStudio/1.0 (+https://developer.wordpress.com/studio/)';

/**
 * Trim, default a missing scheme to https, and return a canonical href.
 * Returns null when there's nothing parseable.
 */
export function normalizeUrl( rawUrl: string ): string | null {
	const trimmed = rawUrl.trim();
	if ( trimmed === '' ) {
		return null;
	}
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test( trimmed ) ? trimmed : `https://${ trimmed }`;
	try {
		return new URL( withScheme ).href;
	} catch {
		return null;
	}
}

function ipv4IsPrivateOrReserved( host: string ): boolean {
	const octets = host.split( '.' ).map( ( part ) => Number( part ) );
	if ( octets.length !== 4 || octets.some( ( n ) => ! Number.isInteger( n ) ) ) {
		return true;
	}
	const [ a, b ] = octets;
	if ( a === 10 || a === 127 || a === 0 ) return true; // private, loopback, "this host"
	if ( a === 172 && b >= 16 && b <= 31 ) return true; // private
	if ( a === 192 && b === 168 ) return true; // private
	if ( a === 169 && b === 254 ) return true; // link-local
	if ( a === 100 && b >= 64 && b <= 127 ) return true; // CGNAT
	if ( a === 192 && b === 0 ) return true; // IETF protocol assignments / 192.0.0.0/24 + 192.0.2.0/24
	if ( a === 198 && ( b === 18 || b === 19 ) ) return true; // benchmarking
	if ( a >= 224 ) return true; // multicast + reserved/broadcast
	return false;
}

function ipv6IsPrivateOrReserved( host: string ): boolean {
	const normalized = host.toLowerCase();
	if ( normalized === '::1' || normalized === '::' ) return true; // loopback / unspecified
	if ( normalized.startsWith( 'fc' ) || normalized.startsWith( 'fd' ) ) return true; // ULA fc00::/7
	if ( normalized.startsWith( 'fe8' ) || normalized.startsWith( 'fe9' ) ) return true; // link-local
	if ( normalized.startsWith( 'fea' ) || normalized.startsWith( 'feb' ) ) return true; // link-local

	// IPv4-mapped (::ffff:a.b.c.d). `URL` normalizes the dotted tail to hex
	// (::ffff:7f00:1), so handle both forms before delegating to the v4 check.
	const dotted = normalized.match( /^::ffff:(\d+\.\d+\.\d+\.\d+)$/ );
	if ( dotted ) return ipv4IsPrivateOrReserved( dotted[ 1 ] );
	const hex = normalized.match( /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/ );
	if ( hex ) {
		const high = parseInt( hex[ 1 ], 16 );
		const low = parseInt( hex[ 2 ], 16 );
		const ipv4 = `${ high >> 8 }.${ high & 0xff }.${ low >> 8 }.${ low & 0xff }`;
		return ipv4IsPrivateOrReserved( ipv4 );
	}
	return false;
}

/**
 * Reject non-http(s) schemes, hostless URLs, bare single-label hosts,
 * localhost, and literal private/reserved IP addresses. The argument is
 * expected to already be a normalized absolute URL.
 */
export function isFetchableUrl( url: string ): boolean {
	let parsed: URL;
	try {
		parsed = new URL( url );
	} catch {
		return false;
	}

	if ( parsed.protocol !== 'http:' && parsed.protocol !== 'https:' ) {
		return false;
	}

	// `URL` keeps IPv6 hosts wrapped in brackets; strip them for `isIP`.
	const host = parsed.hostname.replace( /^\[|\]$/g, '' ).toLowerCase();
	if ( host === '' ) {
		return false;
	}
	if ( host === 'localhost' || host.endsWith( '.localhost' ) ) {
		return false;
	}

	const ipVersion = isIP( host );
	if ( ipVersion === 4 ) {
		return ! ipv4IsPrivateOrReserved( host );
	}
	if ( ipVersion === 6 ) {
		return ! ipv6IsPrivateOrReserved( host );
	}

	// Not an IP literal: require a dotted host so bare single-label names
	// ("intranet", a container alias) don't resolve against internal DNS.
	return host.includes( '.' );
}

const NAMED_ENTITIES: Record< string, string > = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	'#39': "'",
};

function decodeEntities( text: string ): string {
	return text.replace( /&(#x?[0-9a-f]+|[a-z]+);/gi, ( match, entity: string ) => {
		const named = NAMED_ENTITIES[ entity.toLowerCase() ];
		if ( named !== undefined ) {
			return named;
		}
		if ( entity.startsWith( '#x' ) || entity.startsWith( '#X' ) ) {
			const code = parseInt( entity.slice( 2 ), 16 );
			return Number.isNaN( code ) ? match : String.fromCodePoint( code );
		}
		if ( entity.startsWith( '#' ) ) {
			const code = parseInt( entity.slice( 1 ), 10 );
			return Number.isNaN( code ) ? match : String.fromCodePoint( code );
		}
		return match;
	} );
}

export function collapseWhitespace( text: string ): string {
	return decodeEntities( text ).replace( /\s+/g, ' ' ).trim();
}

function stripTags( html: string ): string {
	return collapseWhitespace( html.replace( /<[^>]+>/g, ' ' ) );
}

function matchAllText( html: string, tag: string ): string[] {
	const pattern = new RegExp( `<${ tag }\\b[^>]*>([\\s\\S]*?)</${ tag }>`, 'gi' );
	const out: string[] = [];
	for ( const match of html.matchAll( pattern ) ) {
		const text = stripTags( match[ 1 ] );
		if ( text !== '' ) {
			out.push( text );
		}
	}
	return out;
}

/**
 * Pull the title, meta description, the first headings, the first few
 * substantive paragraphs, and the footer out of a raw HTML document into a
 * single newline-joined brief. Best-effort and dependency-free: it never
 * throws, and returns '' when nothing useful is present (e.g. an SPA shell).
 */
export function extractPageText( html: string ): string {
	// Drop content that never contributes readable copy before matching.
	const cleaned = html
		.replace( /<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ' )
		.replace( /<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ' )
		.replace( /<!--[\s\S]*?-->/g, ' ' );

	const parts: string[] = [];

	const title = matchAllText( cleaned, 'title' )[ 0 ];
	if ( title ) {
		parts.push( `TITLE: ${ title }` );
	}

	const descMatch =
		cleaned.match( /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i ) ??
		cleaned.match( /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i ) ??
		cleaned.match(
			/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i
		);
	if ( descMatch ) {
		const desc = collapseWhitespace( descMatch[ 1 ] );
		if ( desc ) {
			parts.push( `DESCRIPTION: ${ desc }` );
		}
	}

	for ( const h1 of matchAllText( cleaned, 'h1' ).slice( 0, 2 ) ) {
		parts.push( `H1: ${ h1 }` );
	}
	for ( const h2 of matchAllText( cleaned, 'h2' ).slice( 0, 6 ) ) {
		parts.push( `H2: ${ h2 }` );
	}

	// Prefer paragraphs inside <main>/<article>; fall back to all paragraphs.
	const mainScope =
		cleaned.match( /<main\b[^>]*>([\s\S]*?)<\/main>/i )?.[ 1 ] ??
		cleaned.match( /<article\b[^>]*>([\s\S]*?)<\/article>/i )?.[ 1 ];
	const paragraphs = matchAllText( mainScope ?? cleaned, 'p' )
		.filter( ( text ) => text.length >= 40 && text.length <= 600 )
		.slice( 0, 5 );
	for ( const paragraph of paragraphs ) {
		parts.push( `P: ${ paragraph }` );
	}

	const footer = matchAllText( cleaned, 'footer' )[ 0 ];
	if ( footer ) {
		parts.push( `FOOTER: ${ footer.slice( 0, 1000 ) }` );
	}

	const text = parts.join( '\n' );
	return text.length > EXCERPT_MAX_CHARS ? text.slice( 0, EXCERPT_MAX_CHARS ) : text;
}
