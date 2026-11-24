/**
 * Compact HS256 JSON Web Tokens over Web Crypto, so the same code signs and checks them in Node
 * and in a worker. Studio Cloud's control plane signs a machine's session tokens with that
 * machine's secret, and `studio serve` checks them and signs its own site-access tokens.
 */

export interface SignedTokenClaims {
	// What the token is for, so one kind is never accepted as another.
	purpose: string;
	// Expiry, in seconds since the epoch.
	exp: number;
	[ claim: string ]: unknown;
}

const encoder = new TextEncoder();

function toBase64Url( bytes: Uint8Array ): string {
	let binary = '';
	for ( const byte of bytes ) {
		binary += String.fromCharCode( byte );
	}
	return btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );
}

function fromBase64Url( value: string ): Uint8Array< ArrayBuffer > {
	const binary = atob( value.replace( /-/g, '+' ).replace( /_/g, '/' ) );
	return Uint8Array.from( binary, ( char ) => char.charCodeAt( 0 ) );
}

function importKey( secret: string ): Promise< CryptoKey > {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode( secret ),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		[ 'sign', 'verify' ]
	);
}

const HEADER = toBase64Url( encoder.encode( JSON.stringify( { alg: 'HS256', typ: 'JWT' } ) ) );

export async function signToken( claims: SignedTokenClaims, secret: string ): Promise< string > {
	const body = `${ HEADER }.${ toBase64Url( encoder.encode( JSON.stringify( claims ) ) ) }`;
	const signature = await crypto.subtle.sign(
		'HMAC',
		await importKey( secret ),
		encoder.encode( body )
	);
	return `${ body }.${ toBase64Url( new Uint8Array( signature ) ) }`;
}

/** The token's claims when its signature, purpose and expiry check out, otherwise null. */
export async function verifyToken(
	token: string,
	secret: string,
	purpose: string
): Promise< SignedTokenClaims | null > {
	const [ header, payload, signature ] = token.split( '.' );
	if ( header !== HEADER || ! payload || ! signature ) {
		return null;
	}
	try {
		const valid = await crypto.subtle.verify(
			'HMAC',
			await importKey( secret ),
			fromBase64Url( signature ),
			encoder.encode( `${ header }.${ payload }` )
		);
		if ( ! valid ) {
			return null;
		}
		const claims = JSON.parse( new TextDecoder().decode( fromBase64Url( payload ) ) );
		if ( claims?.purpose !== purpose || typeof claims.exp !== 'number' ) {
			return null;
		}
		return claims.exp > Date.now() / 1000 ? claims : null;
	} catch {
		return null;
	}
}
