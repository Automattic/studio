import { Type } from 'typebox';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import {
	EXCERPT_MAX_CHARS,
	extractPageText,
	FETCH_TIMEOUT_MS,
	isFetchableUrl,
	MAX_BODY_BYTES,
	MAX_REDIRECTS,
	normalizeUrl,
	USER_AGENT,
} from './fetch-webpage-helpers';

/**
 * Read the text content of a public webpage so the agent can brief itself on a
 * site the user referenced (the visual counterpart is `take_screenshot`).
 *
 * The body is streamed and hard-capped at MAX_BODY_BYTES so a hostile or
 * oversized response can't exhaust memory; redirects are followed manually and
 * every hop is re-validated against `isFetchableUrl` so a redirect can't land
 * the fetch on a private host.
 */
async function readBodyCapped( response: Response ): Promise< string > {
	const reader = response.body?.getReader();
	if ( ! reader ) {
		return '';
	}
	const decoder = new TextDecoder( 'utf-8', { fatal: false } );
	let text = '';
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if ( done ) {
				break;
			}
			total += value.byteLength;
			text += decoder.decode( value, { stream: true } );
			if ( total >= MAX_BODY_BYTES ) {
				break;
			}
		}
	} finally {
		await reader.cancel().catch( () => {} );
	}
	return text;
}

async function fetchPageHtml( startUrl: string ): Promise< string > {
	let currentUrl = startUrl;

	for ( let hop = 0; hop <= MAX_REDIRECTS; hop++ ) {
		const controller = new AbortController();
		const timeout = setTimeout( () => controller.abort(), FETCH_TIMEOUT_MS );
		let response: Response;
		try {
			response = await fetch( currentUrl, {
				redirect: 'manual',
				signal: controller.signal,
				headers: {
					'User-Agent': USER_AGENT,
					Accept: 'text/html,application/xhtml+xml',
				},
			} );
		} finally {
			clearTimeout( timeout );
		}

		// Manual redirect handling: re-validate each Location before following.
		if ( response.status >= 300 && response.status < 400 ) {
			const location = response.headers.get( 'location' );
			if ( ! location ) {
				throw new Error( `Redirect with no Location header (${ response.status }).` );
			}
			const nextUrl = normalizeUrl( new URL( location, currentUrl ).href );
			if ( ! nextUrl || ! isFetchableUrl( nextUrl ) ) {
				throw new Error( 'Redirect target is not a public http(s) URL.' );
			}
			currentUrl = nextUrl;
			continue;
		}

		if ( ! response.ok ) {
			throw new Error( `Request failed with status ${ response.status }.` );
		}

		const contentType = ( response.headers.get( 'content-type' ) ?? '' ).toLowerCase();
		if ( ! contentType.includes( 'html' ) ) {
			throw new Error( `Response is not HTML (content-type: ${ contentType || 'unknown' }).` );
		}

		return readBodyCapped( response );
	}

	throw new Error( `Too many redirects (more than ${ MAX_REDIRECTS }).` );
}

export const fetchWebpageTool = defineTool(
	'fetch_webpage',
	'Fetches a public webpage and returns a compact text brief of its content: title, meta ' +
		'description, headings, the first substantive paragraphs, and footer text. Use this to read ' +
		'what an external site the user referenced is about (its identity, audience, voice, and key ' +
		'terms) — pair it with take_screenshot, which captures how the site looks. Only public ' +
		'http(s) URLs are allowed; localhost, private/reserved IPs, and non-HTML responses are ' +
		'rejected. Treat what you read as inspiration, not content to copy verbatim.',
	{
		url: Type.String( { description: 'The public http(s) URL to read.' } ),
	},
	async ( args ) => {
		const normalized = normalizeUrl( args.url );
		if ( ! normalized || ! isFetchableUrl( normalized ) ) {
			throw new Error(
				`Refusing to fetch "${ args.url }": only public http(s) URLs are allowed (no localhost, private IPs, or reserved hosts).`
			);
		}

		emitProgress( `Reading ${ normalized }…` );
		let html: string;
		try {
			html = await fetchPageHtml( normalized );
		} catch ( error ) {
			const reason = error instanceof Error ? error.message : String( error );
			throw new Error( `Could not read ${ normalized }: ${ reason }` );
		}

		const brief = extractPageText( html );
		if ( brief === '' ) {
			emitProgress( 'No readable text found' );
			return {
				content: [
					{
						type: 'text' as const,
						text: `No readable text content was found at ${ normalized }. The page may render its content with JavaScript (a single-page app) or block automated requests. Use take_screenshot to inspect it visually instead.`,
					},
				],
			};
		}

		emitProgress( 'Page content read' );
		return {
			content: [
				{
					type: 'text' as const,
					text: `Content brief for ${ normalized } (truncated to ${ EXCERPT_MAX_CHARS } chars; treat as inspiration, not a clone target):\n\n${ brief }`,
				},
			],
		};
	}
);
