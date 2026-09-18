import * as cheerio from 'cheerio';

export function isAbsentDocumentStatus( status: number ): boolean {
	return status === 404 || status === 410;
}

export function isAbsentDocumentError( error: string ): boolean {
	return /^HTTP (404|410)\b/.test( error );
}

/** A rendered document this thin (or thinner) is a candidate for being a
 * client-routed not-found screen rather than a real page. Chosen from the
 * real mint-brand-vote.base44.app capture this guards: its two not-found
 * routes render 87 and 91 characters of body text, while every real route
 * in the same app -- including ones that are themselves short empty states
 * ("Access Denied", "Sign in to Vote") -- renders at least 228, comfortably
 * clear of this ceiling with room for another platform's phrasing to run
 * longer.
 */
const ABSENT_DOCUMENT_MAX_BODY_TEXT_LENGTH = 600;

/** A heading whose *entire* text is just the absent-document status number,
 * with nothing else in it (not "Room 404", not "404 Handbook"). */
const ABSENT_DOCUMENT_HEADING_TEXT = /^(404|410)$/;

/**
 * A client-routed SPA serves every route as HTTP 200 and renders its own
 * not-found screen in JavaScript, so `isAbsentDocumentStatus`/
 * `isAbsentDocumentError` -- which only inspect the HTTP layer -- never see
 * it. This looks for the DOM analogue of the same signal instead: a heading
 * whose whole text is the absent-document status code itself, on a document
 * thin enough that it plausibly *is* that fallback screen rather than a real
 * page that happens to mention the number in passing.
 *
 * Deliberately structural, not textual-English or vendor-specific: it never
 * matches a phrase like "Page Not Found" (that string is one platform's
 * wording, and doesn't exist in another's), and it never matches a vendor
 * name. The status numeral is the one thing every absent-document screen
 * shares, English or not, because it's the same protocol convention
 * #257 already treats as authoritative on the HTTP status line -- this is
 * that same signal, read from the page instead of the transport.
 *
 * Both conditions are required so this only fires on documents that are
 * simultaneously (a) declaring themselves to be exactly that status and
 * (b) too thin to be a real page that happens to mention it. Either alone
 * is too weak: a heading of just "404" on a long real document (an article
 * about HTTP status codes, a hotel room number) would misfire on (a) alone;
 * a short real empty state ("Access Denied", "Sign in to vote") would
 * misfire on (b) alone. A caller with additional context -- e.g. that the
 * same rendered template, modulo the requested slug, recurs across more
 * than one discovered route -- can corroborate this further before excluding
 * a route on its strength alone.
 */
export function isAbsentDocumentRender( html: string ): boolean {
	const $ = cheerio.load( html );
	const bodyText = $( 'body' ).text().replace( /\s+/g, ' ' ).trim();
	if ( bodyText.length === 0 || bodyText.length > ABSENT_DOCUMENT_MAX_BODY_TEXT_LENGTH ) {
		return false;
	}
	let hasAbsentDocumentHeading = false;
	$( 'h1, h2, h3, h4, h5, h6' ).each( ( _, el ) => {
		const text = $( el ).text().replace( /\s+/g, ' ' ).trim();
		if ( ABSENT_DOCUMENT_HEADING_TEXT.test( text ) ) hasAbsentDocumentHeading = true;
	} );
	return hasAbsentDocumentHeading;
}

export function failuresAreAbsentDocument(
	failures: Array< { url?: unknown; error?: unknown } >,
	url: string
): boolean {
	const forUrl = failures.filter( ( failure ) => failure.url === url );
	return (
		forUrl.length > 0 &&
		forUrl.every(
			( failure ) =>
				typeof failure.error === 'string' && isAbsentDocumentError( failure.error )
		)
	);
}

export function isSourceCaptureUrl( url: string, sourceUrl: string | undefined ): boolean {
	if ( ! sourceUrl ) return false;
	try {
		return normalizeRoute( url ) === normalizeRoute( sourceUrl );
	} catch {
		return url === sourceUrl;
	}
}

function normalizeRoute( url: string ): string {
	const route = new URL( url );
	route.hash = '';
	route.search = '';
	route.pathname = route.pathname.replace( /\/$/, '' ) || '/';
	return route.href;
}
