import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress } from './network.mjs';

/** An error whose message is safe to show to the visitor. */
export class UserError extends Error {
	status: number;

	constructor( message: string, status = 400 ) {
		super( message );
		this.status = status;
	}
}

const RESERVED_SUFFIXES = [ '.localhost', '.local', '.internal', '.test', '.example', '.invalid' ];

/** Parse what the visitor typed into a crawlable site URL, or throw a UserError. */
export function parseSiteUrl( input: unknown ): URL {
	const raw = typeof input === 'string' ? input.trim() : '';
	if ( ! raw || raw.length > 2048 ) {
		throw new UserError( 'Enter the address of your website.' );
	}
	let url: URL;
	try {
		url = new URL( /^[a-z][a-z\d+.-]*:\/\//i.test( raw ) ? raw : `https://${ raw }` );
	} catch {
		throw new UserError( 'That doesn’t look like a website address.' );
	}
	const host = url.hostname.toLowerCase().replace( /\.$/, '' );
	if (
		! [ 'http:', 'https:' ].includes( url.protocol ) ||
		url.username ||
		url.password ||
		url.port ||
		! host.includes( '.' ) ||
		RESERVED_SUFFIXES.some( ( suffix ) => host.endsWith( suffix ) )
	) {
		throw new UserError( 'That doesn’t look like a public website address.' );
	}
	url.hash = '';
	return url;
}

type Lookup = ( host: string ) => Promise< { address: string }[] >;

const defaultLookup: Lookup = ( host ) => dnsLookup( host, { all: true, verbatim: true } );

/** Reject hosts that don't resolve, or that resolve to anything but public addresses. */
export async function assertPublicHost( hostname: string, lookup: Lookup = defaultLookup ) {
	let addresses: string[];
	try {
		addresses = isIP( hostname )
			? [ hostname ]
			: ( await lookup( hostname ) ).map( ( a ) => a.address );
	} catch {
		addresses = [];
	}
	if ( ! addresses.length ) {
		throw new UserError( 'We couldn’t find that website. Check the address and try again.' );
	}
	if ( ! addresses.every( isPublicAddress ) ) {
		throw new UserError( 'That address isn’t a public website.' );
	}
}

/** Verify a Cloudflare Turnstile token. */
export async function verifyTurnstile(
	secret: string,
	token: unknown,
	remoteIp: string | undefined
): Promise< boolean > {
	if ( typeof token !== 'string' || ! token ) {
		return false;
	}
	const body = new URLSearchParams( { secret, response: token } );
	if ( remoteIp ) {
		body.set( 'remoteip', remoteIp );
	}
	try {
		const response = await fetch( 'https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			body,
			signal: AbortSignal.timeout( 10_000 ),
		} );
		const result = ( await response.json() ) as { success?: boolean };
		return result.success === true;
	} catch {
		return false;
	}
}
