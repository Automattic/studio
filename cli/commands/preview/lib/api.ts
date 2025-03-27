import fs from 'fs';
import WPCOM from 'wpcom';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

export enum SnapshotStatus {
	Pending = '0',
	Processing = '1',
	Active = '2',
}

// Define Zod schemas for API responses
const CreateSiteResponseSchema = z.object( {
	domain_name: z.string().min( 1, 'Domain name is required' ),
	atomic_site_id: z.number().int().positive( 'Site ID must be a positive integer' ),
} );

const StatusResponseSchema = z.object( {
	status: z.enum( [ SnapshotStatus.Pending, SnapshotStatus.Processing, SnapshotStatus.Active ], {
		errorMap: () => ( { message: 'Invalid site status' } ),
	} ),
	domain_name: z.string(),
	atomic_site_id: z.number().int().positive(),
	is_deleted: z.string(),
} );

export type CreateSiteResponse = z.infer< typeof CreateSiteResponseSchema >;
export type StatusResponse = z.infer< typeof StatusResponseSchema >;

const MAX_POLL_ATTEMPTS = 100;
const POLL_INTERVAL_MS = 3000;

export async function uploadArchive(
	archivePath: string,
	token: string,
	action: string
): Promise< { site_url: string; site_id: number } > {
	const wpcom = new WPCOM( token );
	const formData = [
		[
			'import',
			fs.createReadStream( archivePath ),
			{
				filename: 'local-env-site-1.zip',
				contentType: 'application/zip',
			},
		],
	];

	try {
		const rawResponse = await wpcom.req.post< CreateSiteResponse >( {
			path: '/jurassic-ninja/create-new-site-from-zip',
			apiNamespace: 'wpcom/v2',
			formData,
		} );

		// Validate the response against our schema
		const result = CreateSiteResponseSchema.safeParse( rawResponse );

		if ( ! result.success ) {
			throw new LoggerError( 'Invalid API response', action );
		}

		const response = result.data;

		return {
			site_url: response.domain_name,
			site_id: response.atomic_site_id,
		};
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError( 'Invalid API response format', action );
		}

		const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
		throw new LoggerError( `Failed to upload archive: ${ errorMessage }`, action );
	}
}

async function checkSiteStatus( siteId: number, token: string ): Promise< boolean > {
	const wpcom = new WPCOM( token );

	try {
		const rawResponse = await wpcom.req.get< StatusResponse >( '/jurassic-ninja/status', {
			apiNamespace: 'wpcom/v2',
			site_id: siteId,
		} );

		const result = StatusResponseSchema.safeParse( rawResponse );

		if ( ! result.success ) {
			return false;
		}

		const response = result.data;
		return response.status === SnapshotStatus.Active;
	} catch {
		return false;
	}
}

export async function waitForSiteReady(
	siteId: number,
	token: string,
	action: string
): Promise< boolean > {
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
		'Failed to create preview site: site did not become ready within timeout',
		action
	);
}
