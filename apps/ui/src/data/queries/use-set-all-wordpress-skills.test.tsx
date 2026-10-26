import { useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AppProviders } from '@/app/app-providers';
import { createFakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { useSetAllWordPressSkills, useWordPressSkills } from './use-wordpress-skills';
import type { ReactNode } from 'react';

it( 'refreshes global and site skills after a partially completed bulk change', async () => {
	const installed = new Set< string >();
	const connector = createFakeConnector(
		{},
		{
			getWordPressSkillsStatusAllSites: async () =>
				[ 'one', 'two' ].map( ( id ) => ( {
					id,
					displayName: id,
					description: id,
					installed: installed.has( id ),
				} ) ),
			installWordPressSkillToAllSites: async ( id: string ) => {
				if ( id === 'two' ) {
					throw new Error( 'Unable to install the second skill' );
				}
				installed.add( id );
			},
		}
	);
	const queryClient = createTestQueryClient();
	const { result } = renderHook(
		() => ( {
			skills: useWordPressSkills(),
			siteSkills: useQuery( {
				queryKey: [ 'site-agent-files', 'site-one', 'skills' ],
				queryFn: async () => [ ...installed ],
			} ),
			save: useSetAllWordPressSkills(),
		} ),
		{
			wrapper: ( { children }: { children: ReactNode } ) => (
				<AppProviders connector={ connector } queryClient={ queryClient }>
					{ children }
				</AppProviders>
			),
		}
	);
	await waitFor( () => expect( result.current.skills.isSuccess ).toBe( true ) );
	act( () => result.current.save.mutate( { skillIds: [ 'one', 'two' ], installed: true } ) );
	await waitFor( () => expect( result.current.save.isError ).toBe( true ) );
	await waitFor( () =>
		expect( result.current.skills.data ).toEqual( [
			expect.objectContaining( { id: 'one', installed: true } ),
			expect.objectContaining( { id: 'two', installed: false } ),
		] )
	);
	await waitFor( () => expect( result.current.siteSkills.data ).toEqual( [ 'one' ] ) );
} );
