import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useStartSite } from '@/data/queries/use-sites';
import { SessionUIProvider, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { useOpenSiteUrl } from './use-open-site-url';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useStartSite: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );

describe( 'useOpenSiteUrl', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const getSites = vi.fn();
	const startSite = vi.fn().mockResolvedValue( undefined );
	const onToggleSitePreview = vi.fn( () => () => {} );

	const site = createSite( { running: true } );

	beforeEach( () => {
		vi.clearAllMocks();
		// clearAllMocks leaves implementations in place, so reset the default
		// each test overrides.
		startSite.mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( { openSiteUrl, getSites, onToggleSitePreview } );
		useStartSiteMock.mockReturnValue( { isPending: false, mutateAsync: startSite } );
	} );

	it( 'falls back to the external browser without a preview provider', async () => {
		const { result } = renderHook( () => useOpenSiteUrl( site ) );

		await act( () => result.current( '/wp-admin/' ) );

		expect( startSite ).not.toHaveBeenCalled();
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/' );
	} );

	it( 'starts a stopped site before opening', async () => {
		const stoppedSite = createSite( { running: false } );
		getSites.mockResolvedValue( [ createSite( { running: true, port: 9999 } ) ] );
		const { result } = renderHook( () => useOpenSiteUrl( stoppedSite ) );

		await act( () => result.current( '/wp-admin/' ) );

		expect( startSite ).toHaveBeenCalledWith( 'site-1' );
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/' );
	} );

	it( 'drives the in-app preview through auto-login inside the provider', async () => {
		const { result } = renderPreviewHook( site );

		await act( () => result.current.open( '/wp-admin/plugins.php' ) );

		expect( openSiteUrl ).not.toHaveBeenCalled();
		expect( result.current.preview.open ).toBe( true );
		expect( result.current.preview.path ).toBe(
			`/studio-auto-login?redirect_to=${ encodeURIComponent( '/wp-admin/plugins.php' ) }`
		);
	} );

	// The path has to be set before the start resolves, otherwise the preview
	// mounts on the old path and the load it reports back overwrites this one.
	// The redirect stays relative so it survives the port a restart hands out.
	it( 'points the preview at the destination before the start resolves', async () => {
		startSite.mockReturnValue( new Promise( () => {} ) );
		const { result } = renderPreviewHook( createSite( { running: false } ) );

		await act( async () => {
			void result.current.open( '/wp-admin/' );
		} );

		expect( startSite ).toHaveBeenCalledWith( 'site-1' );
		expect( getSites ).not.toHaveBeenCalled();
		expect( result.current.preview.path ).toBe(
			`/studio-auto-login?redirect_to=${ encodeURIComponent( '/wp-admin/' ) }`
		);
	} );

	it( 'leaves the preview pointed at the destination when the start fails', async () => {
		const stoppedSite = createSite( { running: false } );
		startSite.mockRejectedValue( new Error( 'boom' ) );
		const { result } = renderPreviewHook( stoppedSite );

		await act( () => result.current.open( '/wp-admin/' ) );

		expect( result.current.preview.path ).toBe(
			`/studio-auto-login?redirect_to=${ encodeURIComponent( '/wp-admin/' ) }`
		);
	} );
} );

function renderPreviewHook( site: SiteDetails ) {
	return renderHook( () => ( { open: useOpenSiteUrl( site ), preview: useSessionPreviewUI() } ), {
		wrapper: ( { children }: { children: ReactNode } ) => (
			<SessionUIProvider>{ children }</SessionUIProvider>
		),
	} );
}

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Demo Site',
		path: '/Users/example/Studio/demo-site',
		port: 8881,
		running: false,
		phpVersion: '8.4',
		adminUsername: 'admin',
		adminEmail: 'admin@example.com',
		enableDebugLog: false,
		...overrides,
	};
}
