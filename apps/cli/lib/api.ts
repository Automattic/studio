import fs from 'fs';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

export enum SnapshotStatus {
	Pending = '0',
	Processing = '1',
	Active = '2',
}

const createSiteResponseSchema = z.object( {
	domain_name: z.string().min( 1, __( 'Domain name is required' ) ),
	atomic_site_id: z.coerce.number().int().positive( __( 'Site ID must be a positive integer' ) ),
} );

const statusResponseSchema = z.object( {
	status: z.enum( [ SnapshotStatus.Pending, SnapshotStatus.Processing, SnapshotStatus.Active ], {
		error: __( 'Invalid site status' ),
	} ),
	domain_name: z.string(),
	atomic_site_id: z.number().int().positive(),
	is_deleted: z.string(),
} );

const MAX_POLL_ATTEMPTS = 100;
const POLL_INTERVAL_MS = 3000;

export async function uploadArchive(
	archivePath: string,
	token: string,
	wordpressVersion: string,
	atomicSiteId?: number
): Promise< { site_url: string; site_id: number } > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	const formData: [ string, unknown, Record< string, string >? ][] = [
		[
			'import',
			fs.createReadStream( archivePath ),
			{
				filename: 'local-env-site-1.zip',
				contentType: 'application/zip',
			},
		],
	];

	if ( atomicSiteId !== undefined ) {
		formData.push( [ 'site_id', atomicSiteId ] );
	}

	if ( wordpressVersion.length >= 3 ) {
		formData.push( [ 'wordpress_version', wordpressVersion ] );
	}

	try {
		const rawResponse = await wpcom.req.post( {
			path:
				atomicSiteId !== undefined
					? '/jurassic-ninja/update-site-from-zip'
					: '/jurassic-ninja/create-new-site-from-zip',
			apiNamespace: 'wpcom/v2',
			formData,
		} );

		const result = createSiteResponseSchema.parse( rawResponse );

		return {
			site_url: result.domain_name,
			site_id: result.atomic_site_id,
		};
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError( __( 'Invalid API response format' ), error );
		}

		throw new LoggerError( __( 'Failed to upload archive' ), error );
	}
}

async function checkSiteStatus( siteId: number, token: string ): Promise< boolean > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	try {
		const rawResponse = await wpcom.req.get( '/jurassic-ninja/status', {
			apiNamespace: 'wpcom/v2',
			site_id: siteId,
		} );

		const result = statusResponseSchema.parse( rawResponse );

		return result.status === SnapshotStatus.Active;
	} catch {
		return false;
	}
}

export async function waitForSiteReady( siteId: number, token: string ): Promise< boolean > {
	let attempts = 0;

	while ( attempts < MAX_POLL_ATTEMPTS ) {
		const isReady = await checkSiteStatus( siteId, token );
		if ( isReady ) {
			return true;
		}

		attempts++;
		await new Promise( ( resolve ) => setTimeout( resolve, POLL_INTERVAL_MS ) );
	}

	throw new LoggerError(
		__( 'Failed to create preview site: site did not become ready within timeout' )
	);
}

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

export async function validateAccessToken( token: string ): Promise< void > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	try {
		await wpcom.req.get( '/me', { fields: 'ID' } );
	} catch ( error ) {
		throw new LoggerError( __( 'Invalid authentication token' ), error );
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

const rotateReprintSecretResponseSchema = z.object( {
	code: z.number(),
	body: z.object( {
		data: z.object( {
			secret: z.string().min( 1, __( 'Secret cannot be empty' ) ),
		} ),
	} ),
} );

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

const settingsResponseSchema = z.object( {
	updated: z.record( z.string(), z.unknown() ).optional(),
} );

/**
 * Enables the reprint exporter on a WordPress.com site by setting the
 * `reprint_exporter_enabled` site option to the current unix timestamp.
 *
 * wpcomsh gates the `?reprint-api` endpoint on this option being a
 * timestamp within the last 60 minutes (a sliding window that each
 * accepted export request bumps). Studio must call this before the
 * first direct request to the site or preflight will be refused.
 *
 * Uses WPCOM's generic `/sites/{site}/settings` endpoint because
 * wpcomsh does not expose a dedicated enable endpoint (the Jetpack
 * REST proxy path used for `rotate-export-secret` isn't an option).
 *
 * The settings endpoint whitelists keys and silently drops unknown
 * ones with a 200 OK, so we verify that `reprint_exporter_enabled`
 * appears in the `updated` response — catching a stale wpcomsh
 * whitelist here, long before the user hits an opaque preflight 403.
 */
export async function enableReprintExporter(
	siteId: number,
	token: string,
	verbose = false
): Promise< void > {
	const timestamp = Math.floor( Date.now() / 1000 );
	if ( verbose ) {
		console.error(
			`[enableReprintExporter] Setting reprint_exporter_enabled=${ timestamp } on site ${ siteId }…`
		);
	}
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	let rawResponse: unknown;
	try {
		rawResponse = await wpcom.req.post( {
			path: `/sites/${ siteId }/settings`,
			apiNamespace: 'rest/v1.1',
			body: { reprint_exporter_enabled: timestamp },
		} );
	} catch ( error ) {
		if ( verbose ) {
			const message = error instanceof Error ? error.message : String( error );
			console.error(
				`[enableReprintExporter] Failed to set reprint_exporter_enabled=${ timestamp } on site ${ siteId }: ${ message }`
			);
		}
		throw new LoggerError( __( 'Failed to enable the reprint exporter' ), error );
	}

	const parsed = settingsResponseSchema.safeParse( rawResponse );
	const updated = parsed.success ? parsed.data.updated : undefined;
	if ( ! updated || ! ( 'reprint_exporter_enabled' in updated ) ) {
		if ( verbose ) {
			console.error(
				`[enableReprintExporter] Site ${ siteId } settings endpoint did not report reprint_exporter_enabled as updated. Response: ${ JSON.stringify(
					rawResponse
				) }`
			);
		}
		throw new LoggerError(
			__(
				'The site did not acknowledge the reprint exporter activation. The feature may not be available yet on this WordPress.com site.'
			)
		);
	}

	if ( verbose ) {
		console.error(
			`[enableReprintExporter] Set reprint_exporter_enabled=${ JSON.stringify(
				updated.reprint_exporter_enabled
			) } on site ${ siteId }`
		);
	}
}

/**
 * Rotates a WordPress.com site's reprint export secret.
 *
 * Calls the Jetpack bridge endpoint to request a fresh export token.
 * The response is validated against `rotateReprintSecretResponseSchema`
 * and the wrapper `code` must be `200`; otherwise a `LoggerError` is
 * thrown.
 */
export async function rotateReprintSecret( siteId: number, token: string ): Promise< string > {
	const response = await fetch(
		`https://public-api.wordpress.com/rest/v1.1/jetpack-blogs/${ siteId }/rest-api?http_envelope=1&`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${ token }`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify( {
				path: '/wpcomsh/v1/reprint/rotate-export-secret',
			} ),
		}
	);

	if ( ! response.ok ) {
		throw new LoggerError(
			__( 'Failed to rotate the WordPress.com site secret' ),
			new Error( `HTTP ${ response.status }` )
		);
	}

	let rawResponse: unknown;
	try {
		rawResponse = await response.json();
	} catch ( error ) {
		throw new LoggerError(
			__( 'Invalid API response format' ),
			error instanceof Error ? error : new Error( String( error ) )
		);
	}

	try {
		const result = rotateReprintSecretResponseSchema.parse( rawResponse );

		if ( result.code !== 200 ) {
			throw new LoggerError(
				__( 'Failed to rotate the WordPress.com site secret' ),
				new Error(
					`Unexpected response code ${ result.code }. Raw response: ${ JSON.stringify(
						rawResponse
					) }`
				)
			);
		}

		return result.body.data.secret;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}
		if ( error instanceof z.ZodError ) {
			throw new LoggerError(
				__( 'Invalid API response format' ),
				new Error(
					`Zod validation failed: ${ error.message }. Raw response: ${ JSON.stringify(
						rawResponse
					) }`
				)
			);
		}
		throw new LoggerError( __( 'Failed to rotate the WordPress.com site secret' ), error );
	}
}

export async function revokeAuthToken( token: string ): Promise< void > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	try {
		await wpcom.req.del( {
			apiNamespace: 'wpcom/v2',
			path: '/studio-app/token',
			method: 'DELETE',
		} );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to revoke token' ), error );
	}
}
