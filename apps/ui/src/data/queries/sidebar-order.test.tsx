import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/app-providers';
import { createFakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { orderChats, useSidebarPins, useSidebarPreferences } from './use-sidebar-pins';
import type { ReactNode } from 'react';

const items = [ { id: 'c' }, { id: 'b' }, { id: 'a' } ];

describe( 'sidebar order', () => {
	it( 'retains default order until arranged and ignores deleted IDs', () => {
		expect( orderChats( items, undefined ) ).toBe( items );
		expect( orderChats( items, [ 'a', 'deleted', 'b', 'c' ] ) ).toEqual( [
			items[ 2 ],
			items[ 1 ],
			items[ 0 ],
		] );
	} );

	it( 'puts new chats first and new pins last without disturbing saved positions', async () => {
		expect( orderChats( items, [ 'a', 'b' ] ) ).toEqual( [ items[ 0 ], items[ 2 ], items[ 1 ] ] );
		const { result } = renderSidebar( [ 'chat:a', 'chat:b' ] );
		await waitFor( () => expect( result.current.pins.pins ).toHaveLength( 2 ) );
		act( () => result.current.pins.togglePin( 'chat:c' ) );
		await waitFor( () =>
			expect( result.current.pins.pins ).toEqual( [ 'chat:a', 'chat:b', 'chat:c' ] )
		);
	} );

	it( 'saves independent groups, persists mixed pins, and appends a repinned chat', async () => {
		const { result, connector } = renderSidebar( [ 'chat:a', 'site:s', 'chat:b' ] );
		await waitFor( () => expect( result.current.pins.pins ).toHaveLength( 3 ) );
		act( () => result.current.preferences.save( { sidebarChatOrder: { s: [ 'b', 'a' ] } } ) );
		act( () => result.current.pins.togglePin( 'chat:a' ) );
		await waitFor( () =>
			expect( connector.state.preferences.sidebarPins ).toEqual( [ 'site:s', 'chat:b' ] )
		);
		act( () => result.current.pins.togglePin( 'chat:a' ) );
		await waitFor( () =>
			expect( connector.state.preferences.sidebarPins ).toEqual( [ 'site:s', 'chat:b', 'chat:a' ] )
		);
		expect( connector.state.preferences.sidebarChatOrder ).toEqual( { s: [ 'b', 'a' ] } );
	} );
} );

function renderSidebar( sidebarPins: string[] ) {
	const connector = createFakeConnector();
	connector.state.preferences.sidebarPins = sidebarPins;
	const queryClient = createTestQueryClient();
	const view = renderHook(
		() => ( { preferences: useSidebarPreferences(), pins: useSidebarPins() } ),
		{
			wrapper: ( { children }: { children: ReactNode } ) => (
				<AppProviders connector={ connector } queryClient={ queryClient }>
					{ children }
				</AppProviders>
			),
		}
	);
	return { ...view, connector };
}
