import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

export async function deleteSnapshot( atomicSiteId: number, token: string ): Promise< void > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	try {
		await wpcom.req.post( {
			path: '/jurassic-ninja/delete',
			apiNamespace: 'wpcom/v2',
			body: { site_id: atomicSiteId },
		} );
	} catch ( error ) {
		if ( error instanceof Error && 'code' in error && error.code === 'rest_site_already_deleted' ) {
			return;
		}

		throw new LoggerError( __( 'Failed to delete preview site' ), error );
	}
}

export async function deleteAllSnapshots( token: string ): Promise< void > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	try {
		await wpcom.req.post( {
			path: '/jurassic-ninja/delete/all',
			apiNamespace: 'wpcom/v2',
		} );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to delete all preview sites' ), error );
	}
}

const userResponseSchema = z.object( {
	ID: z.number(),
	email: z.string().email(),
	display_name: z.string(),
	username: z.string(),
} );

export async function getUserInfo(
	token: string
): Promise< z.infer< typeof userResponseSchema > > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	try {
		const rawResponse = await wpcom.req.get( '/me', {
			fields: 'ID,username,email,display_name',
		} );
		return userResponseSchema.parse( rawResponse );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to fetch user info' ), error );
	}
}

export interface WpComSiteInfo {
	id: number;
	name: string;
	url: string;
}

/** Without a public key, the site keeps its export window closed. */
export interface ReprintExporterStatus {
	hasPublicKey: boolean;
}

const wpComSitesResponseSchema = z.object( {
	sites: z.array(
		z.object( {
			ID: z.number(),
			name: z.string(),
			URL: z.string(),
			is_deleted: z.boolean().optional(),
			is_a8c: z.boolean().optional(),
		} )
	),
} );

export async function getWpComSites( token: string ): Promise< WpComSiteInfo[] > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	try {
		const rawResponse = await wpcom.req.get(
			{
				apiNamespace: 'rest/v1.2',
				path: '/me/sites',
			},
			{
				fields: 'ID,name,URL,is_deleted,is_a8c',
				filter: 'atomic,wpcom',
				site_activity: 'active',
			}
		);
		const result = wpComSitesResponseSchema.parse( rawResponse );
		return result.sites
			.filter( ( site ) => ! site.is_deleted && ! site.is_a8c )
			.map( ( site ) => ( {
				id: site.ID,
				name: site.name,
				url: site.URL,
			} ) );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			throw new LoggerError( __( 'Invalid API response format' ), error );
		}
		throw new LoggerError( __( 'Failed to fetch WordPress.com sites' ), error );
	}
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
export async function enableReprintExporter(
	siteId: number,
	token: string,
	verbose = false
): Promise< ReprintExporterStatus > {
	let envelope: unknown;
	try {
		envelope = await postJetpackBridge( siteId, token, '/jetpack/v4/reprint/enable-export' );
	} catch ( error ) {
		throw new LoggerError(
			__( 'Failed to enable the reprint exporter' ),
			error instanceof Error ? error : new Error( String( error ) )
		);
	}

	const status = jetpackBridgeInnerCode( envelope );
	if ( status === 200 ) {
		if ( verbose ) {
			console.error( `[enableReprintExporter] Opened the export window on site ${ siteId }` );
		}
		return { hasPublicKey: true };
	}
	if ( status === 409 && jetpackBridgeErrorCode( envelope ) === 'jetpack_reprint_no_credential' ) {
		if ( verbose ) {
			console.error(
				`[enableReprintExporter] Site ${ siteId } has no public key installed (enable-export returned 409)`
			);
		}
		return { hasPublicKey: false };
	}

	if ( verbose ) {
		console.error(
			`[enableReprintExporter] enable-export on site ${ siteId } returned status ${ status }. Response: ${ JSON.stringify(
				envelope
			) }`
		);
	}
	if ( status === 404 ) {
		throw new LoggerError(
			__(
				'This site does not support pulling yet. Update Jetpack on the site to the latest version and try again.'
			)
		);
	}
	throw new LoggerError(
		__( 'Failed to enable the reprint exporter' ),
		new Error( `enable-export returned status ${ status }` )
	);
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
		throw new LoggerError(
			__( 'Failed to install the migration key on the WordPress.com site' ),
			error instanceof Error ? error : new Error( String( error ) )
		);
	}

	const status = jetpackBridgeInnerCode( envelope );
	if ( status !== 200 ) {
		throw new LoggerError(
			__( 'Failed to install the migration key on the WordPress.com site' ),
			new Error(
				`install-public-key returned status ${ status }. Response: ${ JSON.stringify( envelope ) }`
			)
		);
	}
}
