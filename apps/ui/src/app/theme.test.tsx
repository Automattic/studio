import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { ColorScheme } from '@studio/common/lib/user-settings/preferences';

const root = document.documentElement;

function stubSystemScheme( dark: boolean ) {
	const listeners = new Set< () => void >();
	const media = {
		matches: dark,
		addEventListener: vi.fn( ( _event: string, listener: () => void ) =>
			listeners.add( listener )
		),
		removeEventListener: vi.fn( ( _event: string, listener: () => void ) =>
			listeners.delete( listener )
		),
	};
	const other = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
	vi.stubGlobal( 'matchMedia', ( query: string ) =>
		query.includes( 'prefers-color-scheme' ) ? media : other
	);
	return { media, listeners };
}

function renderWithScheme( colorScheme: ColorScheme ) {
	const connector = createFakeConnector();
	connector.state.preferences.colorScheme = colorScheme;
	return renderWithProviders( null, { connector } );
}

afterEach( () => {
	vi.unstubAllGlobals();
	delete root.dataset.colorScheme;
} );

describe( 'Studio appearance preference', () => {
	it( 'uses explicit light and dark preferences instead of the system theme', async () => {
		stubSystemScheme( true );
		const light = renderWithScheme( 'light' );
		await waitFor( () => expect( root.dataset.colorScheme ).toBe( 'light' ) );
		light.unmount();
		renderWithScheme( 'dark' );
		await waitFor( () => expect( root.dataset.colorScheme ).toBe( 'dark' ) );
	} );

	it( 'follows system changes and removes its subscription', async () => {
		const { media, listeners } = stubSystemScheme( false );
		const view = renderWithScheme( 'system' );
		await waitFor( () => expect( listeners.size ).toBeGreaterThan( 0 ) );
		expect( root.dataset.colorScheme ).toBe( 'light' );
		media.matches = true;
		act( () => listeners.forEach( ( listener ) => listener() ) );
		expect( root.dataset.colorScheme ).toBe( 'dark' );
		const subscribed = [ ...listeners ];
		view.unmount();
		for ( const listener of subscribed ) {
			expect( media.removeEventListener ).toHaveBeenCalledWith( 'change', listener );
		}
	} );
} );
