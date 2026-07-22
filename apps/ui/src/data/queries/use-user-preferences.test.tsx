import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { DEFAULT_ACTIVITY_SOUND_PREFERENCES } from '@studio/common/lib/activity-sounds';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
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
	quitSitesBehavior: 'ask',
	locale: 'en',
	defaultSiteDirectory: '',
	studioCliInstalled: true,
	studioCliExternallyManaged: false,
	agenticFeaturesEnabled: true,
	chatNotificationsEnabled: true,
	activitySoundPreferences: DEFAULT_ACTIVITY_SOUND_PREFERENCES,
	agentResponseLength: 'normal',
	defaultAiModel: DEFAULT_MODEL,
	toolPermissions: {},
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
