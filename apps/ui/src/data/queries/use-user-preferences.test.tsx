import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import {
	USER_PREFERENCES_QUERY_KEY,
	useSaveUserPreferences,
	useUserPreferences,
} from './use-user-preferences';
import type { UserPreferences } from '@/data/core';
import type { ReactNode } from 'react';

describe( 'useSaveUserPreferences', () => {
	function renderPreferenceHooks(
		connector: FakeConnector = createFakeConnector( {
			preferences: { colorScheme: 'system', studioCliInstalled: true },
		} )
	) {
		const queryClient = createTestQueryClient();
		const wrapper = ( { children }: { children: ReactNode } ) => (
			<ConnectorProvider connector={ connector }>
				<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
			</ConnectorProvider>
		);
		const view = renderHook(
			() => ( {
				preferences: useUserPreferences(),
				save: useSaveUserPreferences(),
			} ),
			{ wrapper }
		);
		return { ...view, queryClient, connector };
	}

	it( 'merges saved fields into the cache without refetching', async () => {
		const { result, connector } = renderPreferenceHooks();
		await waitFor( () => expect( result.current.preferences.data ).toBeDefined() );

		await result.current.save.mutateAsync( { colorScheme: 'dark' } );

		await waitFor( () => expect( result.current.preferences.data?.colorScheme ).toBe( 'dark' ) );
		expect( connector.getUserPreferences ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'shows each save at once, never letting an older one land over a newer one', async () => {
		const { result, queryClient, connector } = renderPreferenceHooks();
		const tintIntensity = () =>
			queryClient.getQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY )?.tintIntensity;
		await waitFor( () => expect( result.current.preferences.data ).toBeDefined() );

		let finishFirstSave: () => void = () => undefined;
		connector.setUserPreferences.mockImplementationOnce(
			() => new Promise< void >( ( resolve ) => ( finishFirstSave = resolve ) )
		);
		act( () => result.current.save.mutate( { tintIntensity: 30 } ) );
		await waitFor( () => expect( result.current.preferences.data?.tintIntensity ).toBe( 30 ) );
		await act( () => result.current.save.mutateAsync( { tintIntensity: 40 } ) );
		await act( async () => finishFirstSave() );
		expect( tintIntensity() ).toBe( 40 );

		connector.setUserPreferences.mockRejectedValueOnce( new Error( 'Disk full' ) );
		await act( () => result.current.save.mutateAsync( { tintIntensity: 50 } ).catch( () => {} ) );
		expect( tintIntensity() ).toBe( 40 );
	} );

	it( 'keeps a save when a fetch that started before it resolves afterwards', async () => {
		const { result, connector } = renderPreferenceHooks();
		await waitFor( () => expect( result.current.preferences.data ).toBeDefined() );
		const beforeSave = { ...connector.state.preferences };

		// A refetch (e.g. the settings screen mounting) reads the preferences
		// before the save lands, and only resolves once the save has finished.
		let resolveStaleFetch: ( preferences: UserPreferences ) => void = () => undefined;
		connector.getUserPreferences.mockImplementationOnce(
			() => new Promise( ( resolve ) => ( resolveStaleFetch = resolve ) )
		);
		void result.current.preferences.refetch();
		await waitFor( () => expect( connector.getUserPreferences ).toHaveBeenCalledTimes( 2 ) );

		await result.current.save.mutateAsync( { colorScheme: 'dark' } );
		resolveStaleFetch( beforeSave );

		await waitFor( () => expect( result.current.preferences.isFetching ).toBe( false ) );
		expect( result.current.preferences.data?.colorScheme ).toBe( 'dark' );
	} );

	it( 'keeps a save made before the preferences first loaded', async () => {
		const connector = createFakeConnector( { preferences: { colorScheme: 'system' } } );
		const beforeSave = { ...connector.state.preferences };
		let resolveFirstFetch: ( preferences: UserPreferences ) => void = () => undefined;
		connector.getUserPreferences.mockImplementationOnce(
			() => new Promise( ( resolve ) => ( resolveFirstFetch = resolve ) )
		);
		const { result } = renderPreferenceHooks( connector );

		await result.current.save.mutateAsync( { colorScheme: 'dark' } );
		resolveFirstFetch( beforeSave );

		await waitFor( () => expect( result.current.preferences.data?.colorScheme ).toBe( 'dark' ) );
	} );

	it( 're-fetches the CLI installed state instead of trusting the patch', async () => {
		// An uninstall declined behind the main process's native dialog still
		// resolves the IPC call; the refetch must restore the real state.
		const { result, connector } = renderPreferenceHooks();
		await waitFor( () => expect( result.current.preferences.data ).toBeDefined() );
		connector.setUserPreferences.mockResolvedValueOnce( undefined );

		await result.current.save.mutateAsync( { studioCliInstalled: false } );

		await waitFor( () =>
			expect( result.current.preferences.data?.studioCliInstalled ).toBe( true )
		);
		expect( connector.getUserPreferences ).toHaveBeenCalledTimes( 2 );
	} );
} );
