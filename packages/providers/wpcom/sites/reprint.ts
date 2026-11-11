import { __ } from '@wordpress/i18n';
import { RemoteSiteError } from '../../errors';

// The Jetpack Reprint exporter on a WordPress.com site, which a local Reprint
// pulls the site through.

/** The URL of the Jetpack Reprint exporter on a site. */
export function getReprintApiUrl( siteUrl: string ): string {
	const apiUrl = new URL( siteUrl );
	apiUrl.search = '?reprint-api-jetpack';
	return apiUrl.toString();
}

/**
 * POSTs to a site's REST API through the WordPress.com Jetpack proxy. The
 * site's own status and body come back in the envelope's `code` and `body`.
 */
async function postJetpackBridge(
	siteId: number,
	token: string,
	innerPath: string,
	innerBody?: Record< string, unknown >
): Promise< unknown > {
	const response = await fetch(
		`https://public-api.wordpress.com/rest/v1.1/jetpack-blogs/${ siteId }/rest-api?http_envelope=1&`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${ token }`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(
				innerBody
					? { path: innerPath, body: JSON.stringify( innerBody ), json: true }
					: { path: innerPath }
			),
		}
	);
	if ( ! response.ok ) {
		throw new Error( `HTTP ${ response.status }` );
	}
	return response.json();
}

/** The site's own response body inside a Jetpack-bridge envelope, parsed. */
function jetpackBridgeInnerBody( envelope: unknown ): unknown {
	if ( ! envelope || typeof envelope !== 'object' ) {
		return undefined;
	}
	const { body } = envelope as { body?: unknown };
	if ( typeof body !== 'string' ) {
		return body;
	}
	try {
		return JSON.parse( body );
	} catch {
		return undefined;
	}
}

/** The `code` of a WP_Error-shaped inner body, such as `rest_no_route`. */
function jetpackBridgeErrorCode( envelope: unknown ): string | undefined {
	const inner = jetpackBridgeInnerBody( envelope );
	if ( ! inner || typeof inner !== 'object' ) {
		return undefined;
	}
	// A WP_Error reaches us as `code`, or as `error` once WordPress.com's Jetpack proxy has relayed it.
	const { code, error } = inner as { code?: unknown; error?: unknown };
	if ( typeof code === 'string' ) {
		return code;
	}
	return typeof error === 'string' ? error : undefined;
}

/** The site's HTTP status. A missing route can arrive as a 200 with a `rest_no_route` body. */
function jetpackBridgeInnerCode( envelope: unknown ): number {
	if ( ! envelope || typeof envelope !== 'object' ) {
		return 0;
	}
	if ( jetpackBridgeErrorCode( envelope ) === 'rest_no_route' ) {
		return 404;
	}
	const { code } = envelope as { code?: unknown };
	return typeof code === 'number' ? code : 0;
}

/**
 * Opens the site's Reprint export window, which closes an hour after the last
 * export request, and reports whether the site has a public key.
 */
export async function enableReprintExporter( siteId: number, token: string ): Promise< boolean > {
	let envelope: unknown;
	try {
		envelope = await postJetpackBridge( siteId, token, '/jetpack/v4/reprint/enable-export' );
	} catch ( error ) {
		throw new RemoteSiteError( __( 'Failed to enable the reprint exporter' ), undefined, {
			cause: error,
		} );
	}

	const status = jetpackBridgeInnerCode( envelope );
	if ( status === 200 ) {
		return true;
	}
	if ( status === 409 && jetpackBridgeErrorCode( envelope ) === 'jetpack_reprint_no_credential' ) {
		return false;
	}
	const cause = new Error(
		`enable-export on site ${ siteId } returned status ${ status }. Response: ${ JSON.stringify(
			envelope
		) }`
	);
	if ( status === 404 ) {
		throw new RemoteSiteError(
			__(
				'This site does not support pulling yet. Update Jetpack on the site to the latest version and try again.'
			),
			undefined,
			{ cause }
		);
	}
	throw new RemoteSiteError( __( 'Failed to enable the reprint exporter' ), undefined, { cause } );
}

/** Installs a Reprint public key on the site, replacing any earlier key. */
export async function installReprintPublicKey(
	siteId: number,
	token: string,
	publicKey: string
): Promise< void > {
	let envelope: unknown;
	try {
		envelope = await postJetpackBridge( siteId, token, '/jetpack/v4/reprint/install-public-key', {
			public_key: publicKey,
		} );
	} catch ( error ) {
		throw new RemoteSiteError(
			__( 'Failed to install the migration key on the WordPress.com site' ),
			undefined,
			{ cause: error }
		);
	}

	const status = jetpackBridgeInnerCode( envelope );
	if ( status !== 200 ) {
		throw new RemoteSiteError(
			__( 'Failed to install the migration key on the WordPress.com site' ),
			undefined,
			{
				cause: new Error(
					`install-public-key returned status ${ status }. Response: ${ JSON.stringify(
						envelope
					) }`
				),
			}
		);
	}
}
