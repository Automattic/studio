import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useExportFullSite } from '@/data/queries/use-sites';
import { useSiteManagementActions } from './use-site-management-actions';
import type { Connector, SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/data/core') >() ),
	useConnector: vi.fn(),
} ) );

const site = { id: 'site-1', name: 'Site', running: false } as SiteDetails;

let queryClient: QueryClient;
// Never settles, so the export stays in flight for the whole test.
const exportFullSite = vi.fn( () => new Promise< string >( () => {} ) );

function wrapper( { children }: { children: ReactNode } ) {
	return <QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>;
}

function renderActions() {
	return renderHook( () => useSiteManagementActions( site, { onDelete: vi.fn() } ), { wrapper } );
}

beforeEach( () => {
	vi.clearAllMocks();
	queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	} );
	vi.mocked( useConnector ).mockReturnValue( {
		exportFullSite,
		exportDatabase: vi.fn(),
		copySite: vi.fn(),
	} as unknown as Connector );
} );

describe( 'useSiteManagementActions', () => {
	it( 'offers every action on an idle site', () => {
		const { result } = renderActions();

		expect( result.current.map( ( action ) => action.disabled ) ).toEqual( [
			false,
			false,
			false,
			false,
		] );
	} );

	// Each of these reads or rewrites the site tree, so the CLI refuses them
	// while it holds the site. Leaving one enabled means a click that silently
	// does nothing — which is what this guards against.
	it( 'disables every action while the CLI holds the site', () => {
		const busySite = {
			...site,
			operation: { pid: 1, kind: 'settings' as const },
		};

		const { result } = renderHook(
			() => useSiteManagementActions( busySite, { onDelete: vi.fn() } ),
			{ wrapper }
		);

		expect( result.current.map( ( action ) => action.disabled ) ).toEqual( [
			true,
			true,
			true,
			true,
		] );
	} );

	// The screen that starts an export can be navigated away from while it runs.
	// Its `useMutation` observer dies with it, so progress has to come from the
	// mutation cache or the spinner never comes back.
	it( 'still reports an export that was started by a screen since unmounted', async () => {
		const exporter = renderHook( () => useExportFullSite(), { wrapper } );
		act( () => {
			exporter.result.current.mutate( site.id );
		} );
		await waitFor( () => expect( exportFullSite ).toHaveBeenCalledWith( site.id ) );

		exporter.unmount();

		const { result } = renderActions();
		const exportAction = result.current.find( ( action ) => action.id === 'export' );
		expect( exportAction?.loading ).toBe( true );
	} );

	it( 'does not report an export belonging to a different site', async () => {
		const exporter = renderHook( () => useExportFullSite(), { wrapper } );
		act( () => {
			exporter.result.current.mutate( 'other-site' );
		} );
		await waitFor( () => expect( exportFullSite ).toHaveBeenCalledWith( 'other-site' ) );

		const { result } = renderActions();
		const exportAction = result.current.find( ( action ) => action.id === 'export' );
		expect( exportAction?.loading ).toBe( false );
	} );
} );
