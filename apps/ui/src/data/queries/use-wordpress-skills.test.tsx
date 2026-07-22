import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	WORDPRESS_SKILLS_QUERY_KEY,
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
} from './use-wordpress-skills';
import type { Connector, SkillStatus } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

const useConnectorMock = vi.mocked( useConnector );

const SKILLS: SkillStatus[] = [
	{ id: 'studio-cli', displayName: 'Studio CLI', description: 'CLI', installed: true },
	{ id: 'wp-rest-api', displayName: 'WP REST API', description: 'REST', installed: false },
];

function installedInCache( queryClient: QueryClient, skillId: string ): boolean | undefined {
	return queryClient
		.getQueryData< SkillStatus[] >( WORDPRESS_SKILLS_QUERY_KEY )
		?.find( ( skill ) => skill.id === skillId )?.installed;
}

describe( 'use-wordpress-skills mutations', () => {
	let queryClient: QueryClient;

	beforeEach( () => {
		vi.clearAllMocks();
		queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		queryClient.setQueryData( WORDPRESS_SKILLS_QUERY_KEY, SKILLS );
	} );

	const wrapper = ( { children }: { children: ReactNode } ) => (
		<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
	);

	it( 'flips the cached installed state before the install resolves', async () => {
		let resolveInstall = () => {};
		useConnectorMock.mockReturnValue( {
			installWordPressSkillToAllSites: vi.fn(
				() => new Promise< void >( ( resolve ) => ( resolveInstall = resolve ) )
			),
			getWordPressSkillsStatusAllSites: vi.fn( () => Promise.resolve( SKILLS ) ),
		} as unknown as Connector );

		const { result } = renderHook( () => useInstallWordPressSkill(), { wrapper } );

		act( () => result.current.mutate( 'wp-rest-api' ) );

		await waitFor( () => expect( installedInCache( queryClient, 'wp-rest-api' ) ).toBe( true ) );

		act( () => resolveInstall() );
		await waitFor( () => expect( result.current.isPending ).toBe( false ) );
	} );

	it( 'rolls the cache back when the remove fails', async () => {
		useConnectorMock.mockReturnValue( {
			removeWordPressSkillFromAllSites: vi.fn( () =>
				Promise.reject( new Error( 'remove failed' ) )
			),
			getWordPressSkillsStatusAllSites: vi.fn( () => Promise.resolve( SKILLS ) ),
		} as unknown as Connector );

		const { result } = renderHook( () => useRemoveWordPressSkill(), { wrapper } );

		act( () => result.current.mutate( 'studio-cli' ) );

		await waitFor( () => expect( result.current.isError ).toBe( true ) );
		expect( installedInCache( queryClient, 'studio-cli' ) ).toBe( true );
	} );
} );
