import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { pendingBlueprintSlot } from '@/features/sites';
import { useAppMenuNavigation } from './use-app-menu-navigation';
import type { ReactNode } from 'react';

const navigate = vi.fn( async () => undefined );
const showErrorMessageBox = vi.fn();
let addSiteListener: () => void = () => undefined;
let blueprintListener: ( payload: { blueprintPath: string } ) => void = () => undefined;
let settingsListener: ( target: { settingId?: string } ) => void = () => undefined;

let queryClient: QueryClient;

function renderAppMenuNavigation() {
	queryClient = new QueryClient();
	return renderHook( () => useAppMenuNavigation(), {
		wrapper: ( { children }: { children: ReactNode } ) => (
			<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
		),
	} );
}

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
			onOpenSettings: vi.fn( ( listener ) => {
				settingsListener = listener;
				return () => undefined;
			} ),
			readBlueprintFile,
		} );
	} );

	const addSiteOpened = () =>
		expect( navigate ).toHaveBeenCalledWith( expect.objectContaining( { to: '.' } ) );

	const openedSettings = () => {
		const [ [ { search } ] ] = navigate.mock.calls as unknown as [
			[ { search: ( previous: object ) => object } ],
		];
		return search( {} );
	};

	it( 'opens a linked setting on its section and focuses it', () => {
		renderAppMenuNavigation();

		act( () => settingsListener( { settingId: 'theme' } ) );

		expect( openedSettings() ).toMatchObject( {
			settings: 'appearance',
			settingsFocus: 'theme',
		} );
	} );

	it( 'opens General for a linked setting this version does not have', () => {
		renderAppMenuNavigation();

		act( () => settingsListener( { settingId: 'future-setting' } ) );

		expect( openedSettings() ).toMatchObject( {
			settings: 'general',
			settingsFocus: 'future-setting',
		} );
	} );

	it( 'opens Add site from the app menu', () => {
		renderAppMenuNavigation();

		act( () => addSiteListener() );

		addSiteOpened();
	} );

	it( 'opens Add site with a deep-linked Blueprint', async () => {
		readBlueprintFile.mockResolvedValue( {
			meta: { title: 'Deep-linked Blueprint', author: 'Studio' },
		} );
		renderAppMenuNavigation();

		act( () => blueprintListener( { blueprintPath: '/tmp/deep-link.json' } ) );

		await waitFor( addSiteOpened );
		expect( readBlueprintFile ).toHaveBeenCalledWith( '/tmp/deep-link.json' );
		expect( pendingBlueprintSlot.getSnapshot() ).toMatchObject( {
			title: 'Deep-linked Blueprint',
			file: { name: 'deep-link.json' },
		} );
	} );

	it( 'shows an error when a Blueprint deep link cannot be read', async () => {
		const error = new Error( 'Unreadable Blueprint' );
		readBlueprintFile.mockRejectedValue( error );
		renderAppMenuNavigation();

		act( () => blueprintListener( { blueprintPath: '/tmp/broken.json' } ) );

		await waitFor( () =>
			expect( showErrorMessageBox ).toHaveBeenCalledWith( {
				title: 'Failed to load Blueprint',
				message:
					'WordPress Studio could not open the Blueprint. Please check the file and try again.',
				error,
				showOpenLogs: true,
			} )
		);
		expect( navigate ).not.toHaveBeenCalled();
	} );
} );
