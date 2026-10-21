import { captureException } from '@studio/common/lib/error-reporting';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenInDestinations } from './use-open-in-destinations';
import type { SiteDetails } from '@/data/core';

const navigateMock = vi.fn();

vi.mock( '@tanstack/react-router', () => ( { useNavigate: () => navigateMock } ) );
vi.mock( '@/data/core', () => ( { useConnector: vi.fn() } ) );
vi.mock( '@/data/queries/use-user-preferences', () => ( { useUserPreferences: vi.fn() } ) );
vi.mock( '@studio/common/lib/error-reporting', () => ( { captureException: vi.fn() } ) );
vi.mock( '@/data/app-messages', () => ( { toast: { error: vi.fn() } } ) );

const site = { id: 'site-1', name: 'Demo Site', running: true } as SiteDetails;

function destination( id: string ) {
	const { result } = renderHook( () => useOpenInDestinations( site ) );
	const entry = result.current.find( ( item ) => item.id === id );
	if ( ! entry ) {
		throw new Error( `No ${ id } destination` );
	}
	return entry;
}

describe( 'useOpenInDestinations', () => {
	const openSiteInEditor = vi.fn().mockResolvedValue( undefined );
	const openSiteInTerminal = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useConnector, { partial: true } ).mockReturnValue( {
			openSiteInEditor,
			openSiteInTerminal,
			trackEvent: vi.fn().mockResolvedValue( undefined ),
		} );
		vi.mocked( useUserPreferences, { partial: true } ).mockReturnValue( {
			data: { editor: 'zed', terminal: 'terminal' } as never,
		} );
	} );

	it( 'reports terminal failures and tells the user', async () => {
		const error = new Error( 'Terminal unavailable' );
		openSiteInTerminal.mockRejectedValueOnce( error );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		destination( 'terminal' ).open();

		await waitFor( () => expect( captureException ).toHaveBeenCalledWith( error ) );
		expect( toast.error ).toHaveBeenCalledWith( 'Could not open the terminal.' );
	} );

	it( 'sends the user to settings when no editor is configured', () => {
		vi.mocked( useUserPreferences, { partial: true } ).mockReturnValue( { data: undefined } );

		destination( 'editor' ).open();

		expect( navigateMock ).toHaveBeenCalledWith( { to: '/settings' } );
		expect( openSiteInEditor ).not.toHaveBeenCalled();
	} );
} );
