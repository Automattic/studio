import { describe, expect, it } from 'vitest';
import { UNSET, toPreferencesFormData, toPreferencesPatch } from './preferences';
import type { UserPreferences } from '@/data/core';

const SAVED_PREFERENCES: UserPreferences = {
	editor: 'vscode',
	terminal: 'terminal',
	colorScheme: 'system',
	quitSitesBehavior: 'stop',
	locale: 'en',
	analyticsEnabled: true,
};

describe( 'settings preference helpers', () => {
	it( 'resolves form defaults from saved preferences in one place', () => {
		expect(
			toPreferencesFormData( {
				...SAVED_PREFERENCES,
				editor: null,
				terminal: null,
				quitSitesBehavior: undefined,
				locale: 'missing-locale',
			} )
		).toEqual( {
			editor: UNSET,
			terminal: UNSET,
			colorScheme: 'system',
			quitSitesBehavior: UNSET,
			locale: 'en',
			analyticsEnabled: true,
		} );
	} );

	it( 'returns an empty patch for an empty update', () => {
		expect( toPreferencesPatch( {} ) ).toEqual( {} );
	} );

	it( 'maps a single-field update to a single-field patch', () => {
		expect( toPreferencesPatch( { colorScheme: 'dark' } ) ).toEqual( { colorScheme: 'dark' } );
		expect( toPreferencesPatch( { locale: 'es' } ) ).toEqual( { locale: 'es' } );
		expect( toPreferencesPatch( { quitSitesBehavior: 'leave-running' } ) ).toEqual( {
			quitSitesBehavior: 'leave-running',
		} );
	} );

	it( 'persists the editor/terminal UNSET sentinel as null', () => {
		expect( toPreferencesPatch( { editor: UNSET } ) ).toEqual( { editor: null } );
		expect( toPreferencesPatch( { terminal: UNSET } ) ).toEqual( { terminal: null } );
	} );

	it( 'persists the quit-sites UNSET sentinel as undefined ("ask every time")', () => {
		expect( toPreferencesPatch( { quitSitesBehavior: UNSET } ) ).toStrictEqual( {
			quitSitesBehavior: undefined,
		} );
	} );

	it( 'maps every changed field in a multi-field update', () => {
		expect(
			toPreferencesPatch( {
				editor: UNSET,
				terminal: 'iterm',
				colorScheme: 'dark',
				quitSitesBehavior: 'stop-and-auto-start',
				locale: 'es',
			} )
		).toEqual( {
			editor: null,
			terminal: 'iterm',
			colorScheme: 'dark',
			quitSitesBehavior: 'stop-and-auto-start',
			locale: 'es',
		} );
	} );
} );
