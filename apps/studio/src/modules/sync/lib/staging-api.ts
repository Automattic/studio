import {
	listStagingSitesResponseSchema,
	createStagingSiteResponseSchema,
	syncStateResponseSchema,
	validateQuotaResponseSchema,
	type StagingSite,
	type SyncState,
	type ValidateQuotaResponse,
} from '@studio/common/types/staging-site';
import { wpcomRequest } from '../../../lib/wpcom-request-main';
import type { SyncOption } from '@studio/common/types/sync';

export async function listStagingSites( productionSiteId: number ): Promise< StagingSite[] > {
	const data = await wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site`,
		apiNamespace: 'wpcom/v2',
		method: 'GET',
	} );
	return listStagingSitesResponseSchema.parse( data );
}

export async function createStagingSite( productionSiteId: number ): Promise< StagingSite > {
	const data = await wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site`,
		apiNamespace: 'wpcom/v2',
		method: 'POST',
	} );
	return createStagingSiteResponseSchema.parse( data );
}

export async function deleteStagingSite(
	productionSiteId: number,
	stagingSiteId: number
): Promise< void > {
	await wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site/${ stagingSiteId }`,
		apiNamespace: 'wpcom/v2',
		method: 'DELETE',
	} );
}

export async function validateStagingQuota(
	productionSiteId: number
): Promise< ValidateQuotaResponse > {
	const data = await wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site/validate-quota`,
		apiNamespace: 'wpcom/v2',
		method: 'POST',
	} );
	const parsed = validateQuotaResponseSchema.parse( data );
	// Normalise both wire shapes to the same object so callers don't need to branch.
	if ( typeof parsed === 'boolean' ) {
		return { has_enough_quota: parsed };
	}
	return parsed;
}

export async function pushToStaging(
	productionSiteId: number,
	stagingSiteId: number,
	options: SyncOption[]
): Promise< unknown > {
	return wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site/push-to-staging/${ stagingSiteId }`,
		apiNamespace: 'wpcom/v2',
		method: 'POST',
		body: { options },
	} );
}

export async function pullFromStaging(
	productionSiteId: number,
	stagingSiteId: number,
	options: SyncOption[],
	allowWooSync: boolean
): Promise< unknown > {
	return wpcomRequest( {
		path: `/sites/${ productionSiteId }/staging-site/pull-from-staging/${ stagingSiteId }`,
		apiNamespace: 'wpcom/v2',
		method: 'POST',
		body: { options, allow_woo_sync: allowWooSync },
	} );
}

export async function getSyncState( productionSiteId: number ): Promise< SyncState | null > {
	try {
		const data = await wpcomRequest( {
			path: `/sites/${ productionSiteId }/staging-site/sync-state`,
			apiNamespace: 'wpcom/v2',
			method: 'GET',
		} );
		return syncStateResponseSchema.parse( data );
	} catch ( error ) {
		if (
			error &&
			typeof error === 'object' &&
			'statusCode' in error &&
			( error as { statusCode?: number } ).statusCode === 404
		) {
			return null;
		}
		throw error;
	}
}
