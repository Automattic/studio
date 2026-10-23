import { captureException } from '@studio/common/lib/error-reporting';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useStartSite } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenInDestinations } from './use-open-in-destinations';
import type { SiteDetails } from '@/data/core';

vi.mock( '@/data/core', () => ( { useConnector: vi.fn() } ) );
vi.mock( '@/data/queries/use-user-preferences', () => ( { useUserPreferences: vi.fn() } ) );
vi.mock( '@/data/queries/use-installed-apps', () => ( { useInstalledApps: vi.fn() } ) );
vi.mock( '@/data/queries/use-sites', () => ( { useStartSite: vi.fn() } ) );
vi.mock( '@studio/common/lib/error-reporting', () => ( { captureException: vi.fn() } ) );
vi.mock( '@/data/app-messages', () => ( { toast: { error: vi.fn() } } ) );

const runningSite = { id: 'site-1', name: 'Demo Site', running: true } as SiteDetails;

function destinations( site = runningSite ) {
	return renderHook( () => useOpenInDestinations( site ) ).result.current;
}

function destination( id: string, site = runningSite ) {
	const entry = destinations( site ).find( ( item ) => item.id === id );
	if ( ! entry ) {
		throw new Error( `No ${ id } destination` );
	}
	return entry;
}

describe( 'useOpenInDestinations', () => {
	const openSiteInEditor = vi.fn().mockResolvedValue( undefined );
	const openSiteInTerminal = vi.fn();
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( true );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useConnector, { partial: true } ).mockReturnValue( {
			openSiteInEditor,
			openSiteInTerminal,
			openSiteUrl,
			trackEvent: vi.fn().mockResolvedValue( undefined ),
		} );
		vi.mocked( useUserPreferences, { partial: true } ).mockReturnValue( {
			data: { editor: 'zed', terminal: 'terminal' } as never,
		} );
		vi.mocked( useInstalledApps, { partial: true } ).mockReturnValue( { data: undefined } );
		vi.mocked( useStartSite, { partial: true } ).mockReturnValue( { mutateAsync: startSite } );
	} );

	it( 'reports a failure to open and tells the user', async () => {
		const error = new Error( 'Terminal unavailable' );
		openSiteInTerminal.mockRejectedValueOnce( error );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		destination( 'terminal' ).open();

		await waitFor( () => expect( captureException ).toHaveBeenCalledWith( error ) );
		expect( toast.error ).toHaveBeenCalledWith( 'Couldn’t open Terminal', {
			description: 'Terminal unavailable',
		} );
	} );

	it( 'opens the first installed editor when none is preferred, and hides it when none is installed', () => {
		vi.mocked( useUserPreferences, { partial: true } ).mockReturnValue( { data: undefined } );
		vi.mocked( useInstalledApps, { partial: true } ).mockReturnValue( {
			data: { vscode: false, cursor: true } as never,
		} );

		const editor = destination( 'editor' );
		editor.open();

		expect( editor.label ).toBe( 'Cursor' );
		expect( openSiteInEditor ).toHaveBeenCalledWith( 'site-1' );

		vi.mocked( useInstalledApps, { partial: true } ).mockReturnValue( { data: {} as never } );
		expect( destinations().some( ( item ) => item.id === 'editor' ) ).toBe( false );
	} );

	it( 'starts a stopped site before opening phpMyAdmin', async () => {
		const stoppedSite = { ...runningSite, running: false };

		destination( 'phpmyadmin', stoppedSite ).open();

		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith(
				'site-1',
				expect.stringContaining( 'phpmyadmin' )
			)
		);
		expect( startSite ).toHaveBeenCalledWith( 'site-1' );
		expect( startSite.mock.invocationCallOrder[ 0 ] ).toBeLessThan(
			openSiteUrl.mock.invocationCallOrder[ 0 ]
		);
	} );
} );
