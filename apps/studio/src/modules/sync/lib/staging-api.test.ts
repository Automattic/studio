import { describe, it, expect, vi, beforeEach } from 'vitest';

const wpcomRequest = vi.fn();
vi.mock( '../../../lib/wpcom-request-main', () => ( {
	wpcomRequest: ( ...args: any[] ) => wpcomRequest( ...args ),
} ) );

import {
	listStagingSites,
	createStagingSite,
	pushToStaging,
	pullFromStaging,
	getSyncState,
	validateStagingQuota,
	deleteStagingSite,
} from './staging-api';

describe( 'staging-api', () => {
	beforeEach( () => wpcomRequest.mockReset() );

	it( 'listStagingSites hits GET /sites/{id}/staging-site', async () => {
		wpcomRequest.mockResolvedValue( [] );
		await listStagingSites( 42 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site',
			apiNamespace: 'wpcom/v2',
			method: 'GET',
		} );
	} );

	it( 'createStagingSite POSTs to /sites/{id}/staging-site', async () => {
		wpcomRequest.mockResolvedValue( { id: 99, name: 'S', url: 'u' } );
		const r = await createStagingSite( 42 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site',
			apiNamespace: 'wpcom/v2',
			method: 'POST',
		} );
		expect( r.id ).toBe( 99 );
	} );

	it( 'validateStagingQuota POSTs to /validate-quota', async () => {
		wpcomRequest.mockResolvedValue( { has_enough_quota: true } );
		await validateStagingQuota( 42 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/validate-quota',
			apiNamespace: 'wpcom/v2',
			method: 'POST',
		} );
	} );

	it( 'pushToStaging passes options in body', async () => {
		wpcomRequest.mockResolvedValue( { ok: true } );
		await pushToStaging( 42, 77, [ 'sqls', 'uploads' ] );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/push-to-staging/77',
			apiNamespace: 'wpcom/v2',
			method: 'POST',
			body: { options: [ 'sqls', 'uploads' ] },
		} );
	} );

	it( 'pullFromStaging passes allow_woo_sync', async () => {
		wpcomRequest.mockResolvedValue( { ok: true } );
		await pullFromStaging( 42, 77, [ 'sqls' ], true );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/pull-from-staging/77',
			apiNamespace: 'wpcom/v2',
			method: 'POST',
			body: { options: [ 'sqls' ], allow_woo_sync: true },
		} );
	} );

	it( 'deleteStagingSite hits DELETE', async () => {
		wpcomRequest.mockResolvedValue( {} );
		await deleteStagingSite( 42, 77 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/77',
			apiNamespace: 'wpcom/v2',
			method: 'DELETE',
		} );
	} );

	it( 'getSyncState hits GET /sync-state', async () => {
		wpcomRequest.mockResolvedValue( { status: 'idle' } );
		await getSyncState( 42 );
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/42/staging-site/sync-state',
			apiNamespace: 'wpcom/v2',
			method: 'GET',
		} );
	} );
} );
