import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSiteManagementActions } from './use-site-management-actions';
import type { SiteDetails } from '@/data/core';

const idleMutation = { isPending: false, mutate: vi.fn() };
let isSiteBusy = false;

vi.mock( '@/data/queries/use-sites', () => ( {
	useCopySite: () => idleMutation,
	useExportFullSite: () => idleMutation,
	useExportDatabase: () => idleMutation,
	useIsSiteBusy: () => isSiteBusy,
} ) );

const site = { id: 'site-1', name: 'Site', running: false } as SiteDetails;

function disabledById() {
	const { result } = renderHook( () => useSiteManagementActions( site, { onDelete: vi.fn() } ) );
	return Object.fromEntries( result.current.map( ( action ) => [ action.id, action.disabled ] ) );
}

describe( 'useSiteManagementActions', () => {
	it( 'offers every action on an idle site', () => {
		isSiteBusy = false;

		expect( disabledById() ).toEqual( {
			duplicate: false,
			export: false,
			'export-db': false,
			delete: false,
		} );
	} );

	// Each of these reads or rewrites the site tree, so the CLI refuses them
	// while it holds the site. Leaving one enabled means a click that silently
	// does nothing — which is what this guards against.
	it( 'disables every action while the site is held', () => {
		isSiteBusy = true;

		expect( disabledById() ).toEqual( {
			duplicate: true,
			export: true,
			'export-db': true,
			delete: true,
		} );
	} );
} );
