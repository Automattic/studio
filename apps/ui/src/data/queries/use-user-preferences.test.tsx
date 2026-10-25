import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useSaveUserPreferences, useUserPreferences } from './use-user-preferences';
import type { Connector, UserPreferences } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

const useConnectorMock = vi.mocked( useConnector );

const PREFERENCES: UserPreferences = {
	editor: null,
	terminal: null,
	colorScheme: 'system',
	quitSitesBehavior: undefined,
	locale: 'en',
	analyticsEnabled: true,
	defaultSiteDirectory: '',
	studioCliInstalled: true,
	agenticFeaturesEnabled: true,
	studioCliExternallyManaged: false,
};

describe( 'useSaveUserPreferences', () => {
	const getUserPreferences = vi.fn( () => Promise.resolve( PREFERENCES ) );
	const setUserPreferences = vi.fn( () => Promise.resolve() );

	function renderPreferenceHooks() {
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false } },
		} );
		const wrapper = ( { children }: { children: ReactNode } ) => (
			<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
		);
		return renderHook(
			() => ( {
				preferences: useUserPreferences(),
				save: useSaveUserPreferences(),
			} ),
			{ wrapper }
		);
	}

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( {
			getUserPreferences,
			setUserPreferences,
		} as unknown as Connector );
	} );

	it( 'merges saved fields into the cache without refetching', async () => {
		const { result } = renderPreferenceHooks();
		await waitFor( () => expect( result.current.preferences.data ).toBeDefined() );

		await result.current.save.mutateAsync( { colorScheme: 'dark' } );

		await waitFor( () => expect( result.current.preferences.data?.colorScheme ).toBe( 'dark' ) );
		expect( getUserPreferences ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'shows each save at once, never letting an older one land over a newer one', async () => {
		const { result } = renderPreferenceHooks();
		await waitFor( () => expect( result.current.preferences.data ).toBeDefined() );

		let finishFirstSave: () => void = () => undefined;
		setUserPreferences.mockImplementationOnce(
			() => new Promise< void >( ( resolve ) => ( finishFirstSave = resolve ) )
		);
		act( () => result.current.save.mutate( { tintIntensity: 30 } ) );
		await waitFor( () => expect( result.current.preferences.data?.tintIntensity ).toBe( 30 ) );
		await act( () => result.current.save.mutateAsync( { tintIntensity: 40 } ) );
		await act( async () => finishFirstSave() );
		expect( result.current.preferences.data?.tintIntensity ).toBe( 40 );

		setUserPreferences.mockRejectedValueOnce( new Error( 'Disk full' ) );
		await act( () => result.current.save.mutateAsync( { tintIntensity: 50 } ).catch( () => {} ) );
		expect( result.current.preferences.data?.tintIntensity ).toBe( 40 );
	} );

	it( 'keeps a save when a fetch that started before it resolves afterwards', async () => {
		const { result } = renderPreferenceHooks();
		await waitFor( () => expect( result.current.preferences.data ).toBeDefined() );

		// A refetch (e.g. the settings screen mounting) reads the preferences
		// before the save lands, and only resolves once the save has finished.
		let resolveStaleFetch: ( preferences: UserPreferences ) => void = () => undefined;
		getUserPreferences.mockImplementationOnce(
			() => new Promise( ( resolve ) => ( resolveStaleFetch = resolve ) )
		);
		void result.current.preferences.refetch();
		await waitFor( () => expect( getUserPreferences ).toHaveBeenCalledTimes( 2 ) );

		await result.current.save.mutateAsync( { colorScheme: 'dark' } );
		resolveStaleFetch( PREFERENCES );

		await waitFor( () => expect( result.current.preferences.isFetching ).toBe( false ) );
		expect( result.current.preferences.data?.colorScheme ).toBe( 'dark' );
	} );

	it( 'keeps a save made before the preferences first loaded', async () => {
		let resolveFirstFetch: ( preferences: UserPreferences ) => void = () => undefined;
		getUserPreferences.mockImplementationOnce(
			() => new Promise( ( resolve ) => ( resolveFirstFetch = resolve ) )
		);
		// Once saved, the main process returns the saved value.
		getUserPreferences.mockImplementation( () =>
			Promise.resolve( { ...PREFERENCES, colorScheme: 'dark' } )
		);
		const { result } = renderPreferenceHooks();

		await result.current.save.mutateAsync( { colorScheme: 'dark' } );
		resolveFirstFetch( PREFERENCES );

		await waitFor( () => expect( result.current.preferences.data?.colorScheme ).toBe( 'dark' ) );
	} );

	it( 're-fetches the CLI installed state instead of trusting the patch', async () => {
		// An uninstall declined behind the main process's native dialog still
		// resolves the IPC call; the refetch must restore the real state.
		const { result } = renderPreferenceHooks();
		await waitFor( () => expect( result.current.preferences.data ).toBeDefined() );

		await result.current.save.mutateAsync( { studioCliInstalled: false } );

		await waitFor( () =>
			expect( result.current.preferences.data?.studioCliInstalled ).toBe( true )
		);
		expect( getUserPreferences ).toHaveBeenCalledTimes( 2 );
	} );
} );
