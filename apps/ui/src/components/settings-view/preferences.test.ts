import { describe, expect, it } from 'vitest';
import { UNSET, diffPreferencesFromSaved, toPreferencesFormData } from './preferences';
import type { UserPreferences } from '@/data/core';

const SAVED_PREFERENCES: UserPreferences = {
	editor: 'zed',
	terminal: 'terminal',
	colorScheme: 'system',
	locale: 'en',
	defaultSiteDirectory: '/Users/example/Studio',
	studioCliInstalled: false,
};

describe( 'settings preference helpers', () => {
	it( 'resolves form defaults from saved preferences in one place', () => {
		expect(
			toPreferencesFormData( {
				...SAVED_PREFERENCES,
				editor: null,
				terminal: null,
				locale: 'missing-locale',
			} )
		).toEqual( {
			editor: UNSET,
			terminal: UNSET,
			colorScheme: 'system',
			locale: 'en',
			defaultSiteDirectory: '/Users/example/Studio',
			studioCliInstalled: false,
		} );
	} );

	it( 'returns an empty save diff when form values match saved defaults', () => {
		expect(
			diffPreferencesFromSaved( toPreferencesFormData( SAVED_PREFERENCES ), SAVED_PREFERENCES )
		).toEqual( {} );
	} );

	it( 'diffs default site directory and Studio CLI state with other preference fields', () => {
		expect(
			diffPreferencesFromSaved(
				{
					editor: UNSET,
					terminal: 'iterm',
					colorScheme: 'dark',
					locale: 'es',
					defaultSiteDirectory: '/Users/example/Sites',
					studioCliInstalled: true,
				},
				SAVED_PREFERENCES
			)
		).toEqual( {
			editor: null,
			terminal: 'iterm',
			colorScheme: 'dark',
			locale: 'es',
			defaultSiteDirectory: '/Users/example/Sites',
			studioCliInstalled: true,
		} );
	} );
} );
