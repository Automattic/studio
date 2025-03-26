import fs from 'fs';
import WPCOM from 'wpcom';

export interface CreateSiteResponse {
	domain_name: string;
	atomic_site_id: number;
}

export interface StatusResponse {
	status: SnapshotStatus;
	domain_name: string;
	atomic_site_id: number;
	is_deleted: string;
}

export enum SnapshotStatus {
	Pending = '0',
	Processing = '1',
	Active = '2',
}

const MAX_POLL_ATTEMPTS = 100;
const POLL_INTERVAL_MS = 3000;

export async function uploadArchive(
	archivePath: string,
	token: string
): Promise< { site_url?: string; site_id?: number } | Error > {
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
		const response = await wpcom.req.post< CreateSiteResponse >( {
			path: '/jurassic-ninja/create-new-site-from-zip',
			apiNamespace: 'wpcom/v2',
			formData,
		} );

		return {
			site_url: response.domain_name,
			site_id: response.atomic_site_id,
		};
	} catch ( error: unknown ) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
		return new Error( `Failed to upload archive: ${ errorMessage }` );
	}
}

async function checkSiteStatus( siteId: number, token: string ): Promise< boolean > {
	const wpcom = new WPCOM( token );

	try {
		const response = await wpcom.req.get< StatusResponse >( '/jurassic-ninja/status', {
			apiNamespace: 'wpcom/v2',
			site_id: siteId,
		} );

		return response.status === SnapshotStatus.Active;
	} catch {
		return false;
	}
}

export async function waitForSiteReady( siteId: number, token: string ): Promise< boolean > {
	try {
		let attempts = 0;

		while ( attempts < MAX_POLL_ATTEMPTS ) {
			const isReady = await checkSiteStatus( siteId, token );
			if ( isReady ) {
				return true;
			}

			attempts++;
			await new Promise( ( resolve ) => setTimeout( resolve, POLL_INTERVAL_MS ) );
		}

		throw new Error( 'Timeout waiting for preview site to be ready' );
	} catch {
		return false;
	}
}
