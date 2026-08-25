import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { clearPendingBlueprint, peekPendingBlueprint } from '@/lib/pending-blueprint';
import { useAddSiteListener } from './use-add-site-listener';
import type { Connector } from '@/data/core';

const routerMock = vi.hoisted( () => ( {
	navigate: vi.fn(),
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => routerMock.navigate,
} ) );

function HookHost() {
	useAddSiteListener();
	return null;
}

function renderListener( connectorOverrides: Partial< Connector > = {} ) {
	const addSiteListeners: Array< () => void > = [];
	const blueprintListeners: Array< ( payload: { blueprintPath: string } ) => void > = [];

	const connector = {
		onAddSite( listener: () => void ) {
			addSiteListeners.push( listener );
			return () => {};
		},
		onAddSiteWithBlueprint( listener: ( payload: { blueprintPath: string } ) => void ) {
			blueprintListeners.push( listener );
			return () => {};
		},
		readBlueprintFile: vi.fn().mockResolvedValue( {
			meta: { title: 'My Blueprint', description: 'A test blueprint', author: 'Studio' },
			steps: [],
		} ),
		...connectorOverrides,
	} as unknown as Connector;

	render(
		<ConnectorProvider connector={ connector }>
			<HookHost />
		</ConnectorProvider>
	);

	return {
		connector,
		emitAddSite: () => addSiteListeners.forEach( ( listener ) => listener() ),
		emitAddSiteWithBlueprint: ( payload: { blueprintPath: string } ) =>
			blueprintListeners.forEach( ( listener ) => listener( payload ) ),
	};
}

describe( 'useAddSiteListener', () => {
	beforeEach( () => {
		routerMock.navigate.mockReset();
		clearPendingBlueprint();
	} );

	it( 'navigates to onboarding when the add-site menu event fires', () => {
		const { emitAddSite } = renderListener();

		emitAddSite();

		expect( routerMock.navigate ).toHaveBeenCalledWith( { to: '/onboarding' } );
	} );

	it( 'stores the deep-linked blueprint and lands on the create form', async () => {
		const { connector, emitAddSiteWithBlueprint } = renderListener();

		emitAddSiteWithBlueprint( { blueprintPath: '/tmp/blueprint-123.json' } );

		await waitFor( () =>
			expect( routerMock.navigate ).toHaveBeenCalledWith( { to: '/onboarding/create' } )
		);
		expect( connector.readBlueprintFile ).toHaveBeenCalledWith( '/tmp/blueprint-123.json' );
		expect( peekPendingBlueprint() ).toMatchObject( {
			title: 'My Blueprint',
			excerpt: 'A test blueprint',
		} );
	} );

	it( 'falls back to the file name as title when the blueprint has no meta', async () => {
		const { emitAddSiteWithBlueprint } = renderListener( {
			readBlueprintFile: vi.fn().mockResolvedValue( { steps: [] } ),
		} );

		emitAddSiteWithBlueprint( { blueprintPath: '/tmp/blueprint-456.json' } );

		await waitFor( () => expect( routerMock.navigate ).toHaveBeenCalled() );
		expect( peekPendingBlueprint() ).toMatchObject( { title: 'blueprint-456' } );
	} );

	it( 'does not navigate when the blueprint file cannot be read', async () => {
		const consoleError = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const { connector, emitAddSiteWithBlueprint } = renderListener( {
			readBlueprintFile: vi.fn().mockRejectedValue( new Error( 'missing file' ) ),
		} );

		emitAddSiteWithBlueprint( { blueprintPath: '/tmp/gone.json' } );

		await waitFor( () => expect( connector.readBlueprintFile ).toHaveBeenCalled() );
		expect( routerMock.navigate ).not.toHaveBeenCalled();
		expect( peekPendingBlueprint() ).toBeNull();
		consoleError.mockRestore();
	} );
} );
