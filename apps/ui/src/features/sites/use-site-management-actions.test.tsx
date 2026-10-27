import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useExportFullSite } from '@/data/queries/use-sites';
import { applySyncActivity } from '@/data/sync-activity';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { useSiteManagementActions } from './use-site-management-actions';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

const site = { id: 'site-1', name: 'Site', running: false } as SiteDetails;

let queryClient: QueryClient;
let connector: FakeConnector;

function wrapper( { children }: { children: ReactNode } ) {
	return (
		<QueryClientProvider client={ queryClient }>
			<ConnectorProvider connector={ connector }>{ children }</ConnectorProvider>
		</QueryClientProvider>
	);
}

function renderActions( target = site ) {
	return renderHook(
		() => useSiteManagementActions( target, { onDelete: vi.fn(), onImport: vi.fn() } ),
		{ wrapper }
	);
}

const exportsDisabled = ( actions: ReturnType< typeof useSiteManagementActions > ) =>
	actions
		.filter( ( action ) => action.id === 'export' || action.id === 'export-db' )
		.map( ( action ) => action.disabled );

beforeEach( () => {
	queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	} );
	connector = createFakeConnector();
	// Never settles, so the export stays in flight for the whole test.
	connector.exportFullSite.mockReturnValue( new Promise( () => {} ) );
} );

describe( 'useSiteManagementActions', () => {
	it( 'offers every action on an idle site', () => {
		const { result } = renderActions();

		expect( result.current.map( ( action ) => action.disabled ) ).toEqual( [
			false,
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

		const { result } = renderActions( busySite );

		expect( result.current.map( ( action ) => action.disabled ) ).toEqual( [
			true,
			true,
			true,
			true,
			true,
		] );
	} );

	it( 'disables every action while the site is being imported into', () => {
		applySyncActivity( site.id, { kind: 'pending', direction: 'import' } );

		const { result } = renderActions();

		expect( result.current.map( ( action ) => action.disabled ) ).toEqual( [
			true,
			true,
			true,
			true,
			true,
		] );

		applySyncActivity( site.id, { kind: 'success', direction: 'import' } );
	} );

	// The screen that starts an export can be navigated away from while it runs.
	// Its `useMutation` observer dies with it, so progress has to come from the
	// mutation cache or the export actions come back enabled mid-export.
	it( 'still reports an export that was started by a screen since unmounted', async () => {
		const exporter = renderHook( () => useExportFullSite(), { wrapper } );
		act( () => {
			exporter.result.current.mutate( site.id );
		} );
		await waitFor( () => expect( connector.exportFullSite ).toHaveBeenCalledWith( site.id ) );

		exporter.unmount();

		const { result } = renderActions();
		expect( exportsDisabled( result.current ) ).toEqual( [ true, true ] );
	} );

	it( 'does not report an export belonging to a different site', async () => {
		const exporter = renderHook( () => useExportFullSite(), { wrapper } );
		act( () => {
			exporter.result.current.mutate( 'other-site' );
		} );
		await waitFor( () => expect( connector.exportFullSite ).toHaveBeenCalledWith( 'other-site' ) );

		const { result } = renderActions();
		expect( exportsDisabled( result.current ) ).toEqual( [ false, false ] );
	} );
} );
