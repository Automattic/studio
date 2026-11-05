import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { createFakeConnector } from '@/test/fake-connector';
import { useWorkspaceLayoutTracks } from './use-workspace-layout-tracks';
import type { WorkspaceLayout } from '@studio/common/types/workspace-layout';

function setup() {
	const connector = createFakeConnector();
	const view = renderHook(
		( { siteId, narrow } ) => {
			const [ layout, setLayout ] = useState< WorkspaceLayout >( 'split' );
			const run = useWorkspaceLayoutTracks( { layout, siteId, narrow } );
			return { run, setLayout };
		},
		{
			initialProps: { siteId: 'one', narrow: false },
			wrapper: ( { children } ) => (
				<ConnectorProvider connector={ connector }>{ children }</ConnectorProvider>
			),
		}
	);
	return { ...view, connector };
}

it( 'records one committed change for repeated commands and ignores intermediate states', () => {
	const { result, connector } = setup();
	act( () => {
		result.current.run( () => result.current.setLayout( 'panel' ), true );
		result.current.run( () => result.current.setLayout( 'panel' ), true );
	} );
	act( () => {
		result.current.run( () => result.current.setLayout( 'split' ), true );
		result.current.run( () => result.current.setLayout( 'panel' ), true );
	} );
	act( () => result.current.run( () => result.current.setLayout( 'split' ), true ) );
	expect( connector.trackEvent.mock.calls ).toEqual( [
		[ TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED, { layout: 'panel' }, 'one' ],
		[ TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED, { layout: 'split' }, 'one' ],
	] );
} );

it( 'keeps system transitions and context changes quiet and attributes the next gesture to the current site', () => {
	const { result, rerender, connector } = setup();
	act( () => result.current.run( () => result.current.setLayout( 'panel' ) ) );
	rerender( { siteId: 'two', narrow: false } );
	expect( connector.trackEvent ).not.toHaveBeenCalled();
	act( () => result.current.run( () => result.current.setLayout( 'chat' ), true ) );
	expect( connector.trackEvent ).toHaveBeenCalledExactlyOnceWith(
		TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED,
		{ layout: 'chat' },
		'two'
	);
} );

it( 'clears a no-op gesture before a later system layout change', () => {
	const { result, connector } = setup();
	act( () => result.current.run( () => {}, true ) );
	act( () => result.current.setLayout( 'panel' ) );
	expect( connector.trackEvent ).not.toHaveBeenCalled();
} );

it( 'waits for navigation and records the resulting layout once', async () => {
	const { result, connector } = setup();
	let finish!: () => void;
	const navigation = new Promise< void >( ( resolve ) => {
		finish = resolve;
	} );
	act( () =>
		result.current.run( () => {
			result.current.setLayout( 'chat' );
			return navigation;
		}, true )
	);
	expect( connector.trackEvent ).not.toHaveBeenCalled();
	await act( async () => {
		finish();
		await navigation;
	} );
	expect( connector.trackEvent ).toHaveBeenCalledExactlyOnceWith(
		TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED,
		{ layout: 'chat' },
		'one'
	);
} );

it( 'does not attribute navigation to a different site', async () => {
	const { result, rerender, connector } = setup();
	let finish!: () => void;
	const navigation = new Promise< void >( ( resolve ) => {
		finish = resolve;
	} );
	act( () => result.current.run( () => navigation, true ) );
	rerender( { siteId: 'two', narrow: false } );
	act( () => result.current.setLayout( 'panel' ) );
	await act( async () => {
		finish();
		await navigation;
	} );
	expect( connector.trackEvent ).not.toHaveBeenCalled();
} );

it( 'absorbs rejected and throwing recorders without blocking layout updates', async () => {
	const { result, connector } = setup();
	connector.trackEvent.mockRejectedValueOnce( new Error( 'Offline' ) );
	await act( async () => result.current.run( () => result.current.setLayout( 'panel' ), true ) );
	connector.trackEvent.mockImplementationOnce( () => {
		throw new Error( 'Unavailable' );
	} );
	expect( () =>
		act( () => result.current.run( () => result.current.setLayout( 'chat' ), true ) )
	).not.toThrow();
} );

it( 'does not attribute a viewport-forced change during navigation to the user', async () => {
	const { result, rerender, connector } = setup();
	let finish!: () => void;
	const navigation = new Promise< void >( ( resolve ) => {
		finish = resolve;
	} );
	act( () => result.current.run( () => navigation, true ) );
	rerender( { siteId: 'one', narrow: true } );
	act( () => result.current.setLayout( 'panel' ) );
	await act( async () => {
		finish();
		await navigation;
	} );
	expect( connector.trackEvent ).not.toHaveBeenCalled();
} );
