import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { ASSISTANT_QUOTA_QUERY_KEY } from '@/data/queries/use-assistant-quota';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { useAppMenuNavigation } from './use-app-menu-navigation';
import type { ReactNode } from 'react';

const navigate = vi.fn( async () => undefined );
const showErrorMessageBox = vi.fn();
let addSiteListener: () => void = () => undefined;
let blueprintListener: ( payload: { blueprintPath: string } ) => void = () => undefined;
let aiCreditsPurchasedListener: () => void = () => undefined;

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
			onOpenSettings: vi.fn( () => () => undefined ),
			onAiCreditsPurchased: vi.fn( ( listener ) => {
				aiCreditsPurchasedListener = listener;
				return () => undefined;
			} ),
			readBlueprintFile,
		} );
	} );

	it( 'routes Add Site commands to onboarding', () => {
		renderAppMenuNavigation();

		act( () => addSiteListener() );

		expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding' } );
	} );

	it( 'hands a Blueprint deep link to the unified Create route', async () => {
		readBlueprintFile.mockResolvedValue( {
			meta: { title: 'Deep-linked Blueprint', author: 'Studio' },
		} );
		renderAppMenuNavigation();

		act( () => blueprintListener( { blueprintPath: '/tmp/deep-link.json' } ) );

		await waitFor( () => expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding/create' } ) );
		expect( readBlueprintFile ).toHaveBeenCalledWith( '/tmp/deep-link.json' );
		expect( pendingBlueprintSlot.getSnapshot() ).toMatchObject( {
			title: 'Deep-linked Blueprint',
			file: { name: 'deep-link.json' },
		} );
	} );

	it( 'opens the usage settings and refreshes the balance after a credits purchase', () => {
		renderAppMenuNavigation();
		const invalidateQueries = vi.spyOn( queryClient, 'invalidateQueries' );

		act( () => aiCreditsPurchasedListener() );

		expect( invalidateQueries ).toHaveBeenCalledWith( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
		expect( navigate ).toHaveBeenCalledWith( { to: '/settings', search: { tab: 'usage' } } );
	} );

	it( 'shows an error when a Blueprint deep link cannot be read', async () => {
		const error = new Error( 'Unreadable Blueprint' );
		readBlueprintFile.mockRejectedValue( error );
		renderAppMenuNavigation();

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
