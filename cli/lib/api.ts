import fs from 'fs';
import { __ } from '@wordpress/i18n';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
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
		errorMap: () => ( { message: __( 'Invalid site status' ) } ),
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
