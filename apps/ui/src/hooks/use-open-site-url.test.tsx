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
		const wrapper = ( { children }: { children: ReactNode } ) => (
			<SessionUIProvider>{ children }</SessionUIProvider>
		);
		const { result } = renderHook(
			() => ( { open: useOpenSiteUrl( site ), preview: useSessionPreviewUI() } ),
			{ wrapper }
		);

		await act( () => result.current.open( '/wp-admin/plugins.php' ) );

		expect( openSiteUrl ).not.toHaveBeenCalled();
		expect( result.current.preview.open ).toBe( true );
		expect( result.current.preview.path ).toBe(
			`/studio-auto-login?redirect_to=${ encodeURIComponent(
				'http://localhost:8881/wp-admin/plugins.php'
			) }`
		);
	} );

	it( 'reads the restarted site so the redirect uses the fresh port', async () => {
		const stoppedSite = createSite( { running: false } );
		getSites.mockResolvedValue( [ createSite( { running: true, port: 9999 } ) ] );
		const wrapper = ( { children }: { children: ReactNode } ) => (
			<SessionUIProvider>{ children }</SessionUIProvider>
		);
		const { result } = renderHook(
			() => ( { open: useOpenSiteUrl( stoppedSite ), preview: useSessionPreviewUI() } ),
			{ wrapper }
		);

		await act( () => result.current.open( '/wp-admin/' ) );

		expect( startSite ).toHaveBeenCalledWith( 'site-1' );
		expect( result.current.preview.path ).toBe(
			`/studio-auto-login?redirect_to=${ encodeURIComponent( 'http://localhost:9999/wp-admin/' ) }`
		);
	} );
} );

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
