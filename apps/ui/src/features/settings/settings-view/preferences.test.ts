import { describe, expect, it } from 'vitest';
import { UNSET, toPreferencesFormData, toPreferencesPatch } from './preferences';
import type { UserPreferences } from '@/data/core';

const SAVED_PREFERENCES: UserPreferences = {
	editor: 'vscode',
	browser: null,
	terminal: 'terminal',
	colorScheme: 'system',
	quitSitesBehavior: 'stop',
	locale: 'en',
	analyticsEnabled: true,
	defaultSiteDirectory: '/Users/example/Studio',
	studioCliInstalled: false,
	studioCliExternallyManaged: false,
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
			browser: UNSET,
			terminal: UNSET,
			colorScheme: 'system',
			quitSitesBehavior: UNSET,
			locale: 'en',
			analyticsEnabled: true,
			defaultSiteDirectory: '/Users/example/Studio',
			autoStartSiteOnChat: false,
			confirmDeleteAnnotations: true,
		} );
	} );

	it( 'persists the editor/terminal UNSET sentinel as null', () => {
		expect( toPreferencesPatch( { browser: UNSET } ) ).toEqual( { browser: null } );
		expect( toPreferencesPatch( { editor: UNSET } ) ).toEqual( { editor: null } );
		expect( toPreferencesPatch( { terminal: UNSET } ) ).toEqual( { terminal: null } );
	} );

	it( 'persists the quit-sites UNSET sentinel as null ("ask every time")', () => {
		expect( toPreferencesPatch( { quitSitesBehavior: UNSET } ) ).toStrictEqual( {
			quitSitesBehavior: null,
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
				defaultSiteDirectory: '/Users/example/Sites',
			} )
		).toEqual( {
			editor: null,
			terminal: 'iterm',
			colorScheme: 'dark',
			quitSitesBehavior: 'stop-and-auto-start',
			locale: 'es',
			defaultSiteDirectory: '/Users/example/Sites',
		} );
	} );
} );
