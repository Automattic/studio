import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { createFakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import {
	WORDPRESS_SKILLS_QUERY_KEY,
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
} from './use-wordpress-skills';
import type { SkillStatus } from '@/data/core';
import type { ReactNode } from 'react';

const SKILLS: SkillStatus[] = [
	{ id: 'studio-cli', displayName: 'Studio CLI', description: 'CLI', installed: true },
	{ id: 'wp-rest-api', displayName: 'WP REST API', description: 'REST', installed: false },
];

function installedInCache( queryClient: QueryClient, skillId: string ): boolean | undefined {
	return queryClient
		.getQueryData< SkillStatus[] >( WORDPRESS_SKILLS_QUERY_KEY )
		?.find( ( skill ) => skill.id === skillId )?.installed;
}

function setup() {
	const connector = createFakeConnector();
	connector.getWordPressSkillsStatusAllSites.mockResolvedValue( SKILLS );
	const queryClient = createTestQueryClient();
	queryClient.setQueryData( WORDPRESS_SKILLS_QUERY_KEY, SKILLS );
	const wrapper = ( { children }: { children: ReactNode } ) => (
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
		</ConnectorProvider>
	);
	return { connector, queryClient, wrapper };
}

describe( 'use-wordpress-skills mutations', () => {
	it( 'flips the cached installed state before the install resolves', async () => {
		const { connector, queryClient, wrapper } = setup();
		let resolveInstall = () => {};
		connector.installWordPressSkillToAllSites.mockImplementation(
			() => new Promise< void >( ( resolve ) => ( resolveInstall = resolve ) )
		);

		const { result } = renderHook( () => useInstallWordPressSkill(), { wrapper } );

		act( () => result.current.mutate( 'wp-rest-api' ) );

		await waitFor( () => expect( installedInCache( queryClient, 'wp-rest-api' ) ).toBe( true ) );

		act( () => resolveInstall() );
		await waitFor( () => expect( result.current.isPending ).toBe( false ) );
	} );

	it( 'rolls the cache back when the remove fails', async () => {
		const { connector, queryClient, wrapper } = setup();
		connector.removeWordPressSkillFromAllSites.mockRejectedValue( new Error( 'remove failed' ) );

		const { result } = renderHook( () => useRemoveWordPressSkill(), { wrapper } );

		act( () => result.current.mutate( 'studio-cli' ) );

		await waitFor( () => expect( result.current.isError ).toBe( true ) );
		expect( installedInCache( queryClient, 'studio-cli' ) ).toBe( true );
	} );
} );
