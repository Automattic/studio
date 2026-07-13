import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { useAppMenuNavigation } from './use-app-menu-navigation';

const navigate = vi.fn( async () => undefined );
const showErrorMessageBox = vi.fn();
let addSiteListener: () => void = () => undefined;
let blueprintListener: ( payload: { blueprintPath: string } ) => void = () => undefined;

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigate,
} ) );

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: vi.fn() };
} );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const readBlueprintFile = vi.fn();

describe( 'useAppMenuNavigation', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		Object.defineProperty( window, 'ipcApi', {
			configurable: true,
			value: { showErrorMessageBox },
		} );
		const pending = pendingBlueprintSlot.getSnapshot();
		if ( pending ) pendingBlueprintSlot.clear( pending );
		useConnectorMock.mockReturnValue( {
			onAddSite: vi.fn( ( listener ) => {
				addSiteListener = listener;
				return () => undefined;
			} ),
			onAddSiteWithBlueprint: vi.fn( ( listener ) => {
				blueprintListener = listener;
				return () => undefined;
			} ),
			onOpenSettings: vi.fn( () => () => undefined ),
			readBlueprintFile,
		} );
	} );

	it( 'routes Add Site commands to onboarding', () => {
		renderHook( () => useAppMenuNavigation() );

		act( () => addSiteListener() );

		expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding' } );
	} );

	it( 'hands a Blueprint deep link to the unified Create route', async () => {
		readBlueprintFile.mockResolvedValue( {
			meta: { title: 'Deep-linked Blueprint', author: 'Studio' },
		} );
		renderHook( () => useAppMenuNavigation() );

		act( () => blueprintListener( { blueprintPath: '/tmp/deep-link.json' } ) );

		await waitFor( () => expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding/create' } ) );
		expect( readBlueprintFile ).toHaveBeenCalledWith( '/tmp/deep-link.json' );
		expect( pendingBlueprintSlot.getSnapshot() ).toMatchObject( {
			title: 'Deep-linked Blueprint',
			file: { name: 'deep-link.json' },
		} );
	} );

	it( 'shows an error when a Blueprint deep link cannot be read', async () => {
		const error = new Error( 'Unreadable Blueprint' );
		readBlueprintFile.mockRejectedValue( error );
		renderHook( () => useAppMenuNavigation() );

		act( () => blueprintListener( { blueprintPath: '/tmp/broken.json' } ) );

		await waitFor( () =>
			expect( showErrorMessageBox ).toHaveBeenCalledWith( {
				title: 'Failed to load Blueprint',
				message: 'Studio could not open the Blueprint. Please check the file and try again.',
				error,
				showOpenLogs: true,
			} )
		);
		expect( navigate ).not.toHaveBeenCalled();
	} );
} );
