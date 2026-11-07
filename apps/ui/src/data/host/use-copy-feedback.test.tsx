import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { createFakeConnector } from '@/test/fake-connector';
import { useCopyText } from './use-copy-text';
import type { ReactNode } from 'react';

beforeEach( () => vi.useFakeTimers() );
afterEach( () => vi.useRealTimers() );

function renderCopy( connector = createFakeConnector() ) {
	return renderHook( () => useCopyText( 'https://example.test' ), {
		wrapper: ( { children }: { children: ReactNode } ) => (
			<ConnectorProvider connector={ connector }>{ children }</ConnectorProvider>
		),
	} );
}

async function copy( result: { current: { copy: () => void } } ) {
	await act( async () => result.current.copy() );
}

describe( 'copy feedback', () => {
	it( 'expires two seconds after the latest copy', async () => {
		const { result } = renderCopy();
		await copy( result );
		act( () => {
			vi.advanceTimersByTime( 1500 );
		} );
		await copy( result );
		act( () => {
			vi.advanceTimersByTime( 1999 );
		} );
		expect( result.current.copied ).toBe( true );
		act( () => {
			vi.advanceTimersByTime( 1 );
		} );
		expect( result.current.copied ).toBe( false );
	} );

	it.each( [
		[ 'before', false ],
		[ 'after', true ],
	] )( 'leaves no timer when unmounted %s the copy finishes', async ( _, finishedFirst ) => {
		let finish = () => {};
		const connector = createFakeConnector();
		connector.copyText.mockImplementation(
			() => new Promise< void >( ( resolve ) => ( finish = resolve ) )
		);
		const { result, unmount } = renderCopy( connector );
		act( () => result.current.copy() );
		if ( finishedFirst ) {
			await act( async () => finish() );
		}
		unmount();
		await act( async () => finish() );
		expect( vi.getTimerCount() ).toBe( 0 );
	} );
} );
