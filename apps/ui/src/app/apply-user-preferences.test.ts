import { afterEach, expect, it } from 'vitest';
import { queryClient } from '@/data/core';
import { USER_PREFERENCES_QUERY_KEY } from '@/data/queries/use-user-preferences';
import { applyUserPreferences } from './apply-user-preferences';
import type { Connector } from '@/data/core';

const root = document.documentElement;

afterEach( () => {
	root.removeAttribute( 'style' );
	delete root.dataset.colorScheme;
	queryClient.clear();
} );

it( 'applies the saved theme and tint before the first render, and seeds the preferences', async () => {
	const preferences = {
		colorScheme: 'dark',
		accentColor: '#8c52d9',
		tintIntensity: 40,
		contrast: 10,
	};

	await applyUserPreferences( {
		getUserPreferences: () => Promise.resolve( preferences ),
	} as unknown as Connector );

	expect( root.dataset.colorScheme ).toBe( 'dark' );
	expect( Number( root.style.getPropertyValue( '--tint-hue' ) ) ).toBeCloseTo( 299.9, 1 );
	expect( root.style.getPropertyValue( '--tint-intensity' ) ).toBe( '40' );
	expect( root.style.getPropertyValue( '--contrast' ) ).toBe( '10' );
	expect( queryClient.getQueryData( USER_PREFERENCES_QUERY_KEY ) ).toEqual( preferences );
} );

it( 'falls back to the default tint when the preferences fail to load', async () => {
	await applyUserPreferences( {
		getUserPreferences: () => Promise.reject( new Error( 'offline' ) ),
	} as unknown as Connector );

	expect( root.style.getPropertyValue( '--tint-hue' ) ).toBe( '260' );
	expect( root.style.getPropertyValue( '--tint-intensity' ) ).toBe( '0' );
} );
